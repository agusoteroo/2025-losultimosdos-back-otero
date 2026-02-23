import { BookingStatus, PointEventType, PrismaClient } from "@prisma/client";
import { ApiValidationError } from "./api-validation-error";
import UserService from "./user.service";
import PointsService from "./points.service";

const NO_SHOW_POLICY = {
  cancellationWindowHours: 24,
  restrictedAt: 3,
  restrictionMinutes: 2,
};

class BookingService {
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  private getMonthRange(date = new Date()) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    );
    return { start, end };
  }

  private getRecentClassesStartDate() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  }

  private addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private addMinutes(date: Date, minutes: number) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  }

  private getClassStartDateTime(classData: { date: Date; time: string }) {
    const start = new Date(classData.date);
    const match =
      typeof classData.time === "string"
        ? classData.time.match(/^(\d{1,2}):(\d{2})/)
        : null;

    if (!match) {
      return start;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    start.setHours(hours, minutes, 0, 0);
    return start;
  }

  private isLateCancellation(
    booking: { cancelledAt: Date | null },
    classData: { date: Date; time: string }
  ) {
    if (!booking.cancelledAt) return false;

    const classStart = this.getClassStartDateTime(classData);
    const diffMs = classStart.getTime() - booking.cancelledAt.getTime();

    return (
      diffMs > 0 &&
      diffMs < NO_SHOW_POLICY.cancellationWindowHours * 60 * 60 * 1000
    );
  }

  private async getBookingStrikeSummary(userId: string, now = new Date()) {
    const penalty = await this.prisma.userBookingPenalty.findUnique({
      where: { userId },
    });
    const activeRestriction =
      penalty?.restrictedUntil && penalty.restrictedUntil.getTime() > now.getTime()
        ? penalty.restrictedUntil
        : null;
    const strikesInWindow = penalty?.strikes ?? 0;

    return {
      strikeEvents: [],
      strikesInWindow,
      restricted: Boolean(activeRestriction),
      restrictionUntil: activeRestriction,
    };
  }

  private async ensureNoShowRestriction(userId: string) {
    const summary = await this.getBookingStrikeSummary(userId);
    if (summary.restricted) {
      throw new ApiValidationError(
        "No podés reservar clases por 2 minutos porque alcanzaste el límite de strikes",
        403
      );
    }
    return;

    const { start } = this.getMonthRange();
    const noShow = await this.prisma.userNoShowMonthly.findUnique({
      where: { userId_monthStart: { userId, monthStart: start } },
    });

    if ((noShow?.count ?? 0) >= NO_SHOW_POLICY.restrictedAt) {
      throw new ApiValidationError(
        "No podés reservar porque superaste el límite de no-shows mensual",
        403
      );
    }
  }

  private async syncClassEnrollment(classId: number, tx: PrismaClient | any) {
    const activeBookings = await tx.booking.findMany({
      where: { classId, status: BookingStatus.RESERVED },
      select: { userId: true },
    });

    const userIds = Array.from(new Set(activeBookings.map((b: any) => b.userId)));

    await tx.class.update({
      where: { id: classId },
      data: {
        users: { set: userIds },
        enrolled: userIds.length,
      },
    });
  }

  async createBookingFromEnroll(userId: string, classId: number) {
    await this.ensureNoShowRestriction(userId);

    return this.prisma.$transaction(async (tx) => {
      const classData = await tx.class.findUnique({ where: { id: classId } });

      if (!classData) {
        throw new ApiValidationError("Class not found", 404);
      }
      if (process.env.NODE_ENV !== "test" && !(await UserService.hasMedicalCheck(userId))) {
        throw new ApiValidationError("User does not have a medical check", 421);
      }

      const existing = await tx.booking.findFirst({
        where: {
          classId,
          userId,
        },
        orderBy: { createdAt: "desc" },
      });

      if (
        existing &&
        (
          existing.status === BookingStatus.RESERVED ||
          existing.status === BookingStatus.ATTENDED ||
          existing.status === BookingStatus.ABSENT ||
          existing.status === BookingStatus.WAITLIST
        )
      ) {
        throw new ApiValidationError("Already enrolled in this class", 400);
      }

      if (
        existing?.status === BookingStatus.CANCELLED &&
        this.isLateCancellation(existing, classData)
      ) {
        throw new ApiValidationError(
          "No podés volver a reservar esta clase porque la cancelaste con menos de 24 horas de anticipación",
          400
        );
      }

      if (classData.users.includes(userId)) {
        throw new ApiValidationError("Already enrolled in this class", 400);
      }

      const reservedCount = await tx.booking.count({
        where: { classId, status: BookingStatus.RESERVED },
      });

      const effectiveReserved = Math.max(reservedCount, classData.enrolled);

      if (effectiveReserved >= classData.capacity) {
        throw new ApiValidationError("Class is full", 400);
      }


      const booking = await tx.booking.create({
        data: {
          classId,
          userId,
          status: BookingStatus.RESERVED,
        },
      });

      await this.syncClassEnrollment(classId, tx);

      const updatedClass = await tx.class.findUniqueOrThrow({ where: { id: classId } });

      return { booking, updatedClass };
    });
  }

  async cancelBookingFromUnenroll(userId: string, classId: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      const classData = await tx.class.findUnique({ where: { id: classId } });
      if (!classData) {
        throw new ApiValidationError("Class not found", 404);
      }

      const booking = await tx.booking.findFirst({
        where: { classId, userId, status: BookingStatus.RESERVED },
        orderBy: { createdAt: "desc" },
      });

      if (!booking) {
        throw new ApiValidationError("Not enrolled in this class", 400);
      }

      const now = new Date();
      const classStart = this.getClassStartDateTime(classData);
      if (now >= classStart) {
        throw new ApiValidationError(
          "No se puede cancelar una clase una vez iniciada",
          409
        );
      }

      const isLateCancellation =
        classStart.getTime() - now.getTime() <
        NO_SHOW_POLICY.cancellationWindowHours * 60 * 60 * 1000;
      let lateCancellationStrikeApplied = false;

      if (isLateCancellation) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.CANCELLED, cancelledAt: now },
        });

        await this.increaseNoShowCounter(userId, now, tx);
        lateCancellationStrikeApplied = true;
      } else {
        await tx.booking.delete({
          where: { id: booking.id },
        });
      }

      const promotedBooking = await this.promoteWaitlistIfPossible(classId, tx);
      await this.syncClassEnrollment(classId, tx);

      const updatedClass = await tx.class.findUniqueOrThrow({ where: { id: classId } });
      return { updatedClass, promotedBooking, lateCancellationStrikeApplied };
    });

    const promotionAlert = await this.awardPointsForPromotedWaitlistBooking(
      result.promotedBooking
    );

    let strikeAlert: null | {
      type: "LATE_CANCELLATION_STRIKE";
      userId: string;
      strikes: number;
      threshold: number;
      isRestricted: boolean;
      restrictionUntil: Date | null;
    } = null;

    if (result.lateCancellationStrikeApplied) {
      const summary = await this.getBookingStrikeSummary(userId);
      strikeAlert = {
        type: "LATE_CANCELLATION_STRIKE",
        userId,
        strikes: summary.strikesInWindow,
        threshold: NO_SHOW_POLICY.restrictedAt,
        isRestricted: summary.restricted,
        restrictionUntil: summary.restrictionUntil,
      };
    }

    return { updatedClass: result.updatedClass, promotionAlert, strikeAlert };
  }

  private async promoteWaitlistIfPossible(classId: number, tx?: PrismaClient | any) {
    const client = tx ?? this.prisma;
    const classData = await client.class.findUnique({ where: { id: classId } });
    if (!classData) return null;

    const reservedCount = await client.booking.count({
      where: { classId, status: BookingStatus.RESERVED },
    });

    if (reservedCount >= classData.capacity) return null;

    const next = await client.waitlistEntry.findFirst({
      where: { classId },
      orderBy: { createdAt: "asc" },
    });

    if (!next) return null;

    const booking = await client.booking.create({
      data: {
        classId,
        userId: next.userId,
        status: BookingStatus.RESERVED,
        promotedFromWaitlistAt: new Date(),
      },
    });

    await client.waitlistEntry.delete({ where: { id: next.id } });

    return booking;
  }

  async getUserBookings(userId: string, sedeId?: number) {
    const recentClassesStart = this.getRecentClassesStartDate();
    const bookings = await this.prisma.booking.findMany({
      where: {
        userId,
        ...(sedeId ? { class: { sedeId } } : {}),
      },
      include: {
        class: true,
      },
      orderBy: [{ class: { date: "asc" } }, { createdAt: "desc" }],
    });

    return bookings.filter(
      (booking) => this.getClassStartDateTime(booking.class) >= recentClassesStart
    );
  }

  async getNoShowPolicy(userId: string) {
    const now = new Date();
    const summary = await this.getBookingStrikeSummary(userId);
    const { start } = this.getMonthRange();
    return {
      ...NO_SHOW_POLICY,
      isRestricted: summary.restricted,
      monthlyNoShows: summary.strikesInWindow,
      monthlyThreshold: NO_SHOW_POLICY.restrictedAt,
      currentWindow: {
        minutes: NO_SHOW_POLICY.restrictionMinutes,
        noShows: summary.strikesInWindow,
        threshold: NO_SHOW_POLICY.restrictedAt,
        strikes: summary.strikesInWindow,
        restricted: summary.restricted,
        restrictionUntil: summary.restrictionUntil,
        startDate: this.addMinutes(now, -NO_SHOW_POLICY.restrictionMinutes),
        endDate: now,
        remainingBeforeRestriction: Math.max(
          NO_SHOW_POLICY.restrictedAt - summary.strikesInWindow,
          0
        ),
      },
      currentMonth: {
        monthStart: start,
        noShows: summary.strikesInWindow,
        restricted: summary.restricted,
        remainingBeforeRestriction: Math.max(
          NO_SHOW_POLICY.restrictedAt - summary.strikesInWindow,
          0
        ),
      },
    };
  }

  async checkIn(userId: string, bookingId: number) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { class: true },
    });

    if (!booking || booking.userId !== userId) {
      throw new ApiValidationError("Booking not found", 404);
    }

    if (booking.status !== BookingStatus.RESERVED) {
      throw new ApiValidationError("Solo se puede hacer check-in de reservas activas", 400);
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ATTENDED, checkedInAt: new Date() },
      include: { class: true },
    });
  }

  async joinWaitlist(userId: string, classId: number) {
    await this.ensureNoShowRestriction(userId);

    const classData = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!classData) {
      throw new ApiValidationError("Class not found", 404);
    }

    const existingBooking = await this.prisma.booking.findFirst({
      where: {
        classId,
        userId,
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      existingBooking &&
      (
        existingBooking.status === BookingStatus.RESERVED ||
        existingBooking.status === BookingStatus.ATTENDED ||
        existingBooking.status === BookingStatus.ABSENT ||
        existingBooking.status === BookingStatus.WAITLIST
      )
    ) {
      throw new ApiValidationError("Ya tenés una reserva para esta clase", 400);
    }

    if (
      existingBooking?.status === BookingStatus.CANCELLED &&
      this.isLateCancellation(existingBooking, classData)
    ) {
      throw new ApiValidationError(
        "No podés volver a anotarte a esta clase porque la cancelaste con menos de 24 horas de anticipación",
        400
      );
    }

    const reservedCount = await this.prisma.booking.count({
      where: { classId, status: BookingStatus.RESERVED },
    });
    if (reservedCount < classData.capacity) {
      throw new ApiValidationError(
        "La clase aún tiene cupos disponibles. Reservá directamente.",
        400
      );
    }

    const existingWaitlist = await this.prisma.waitlistEntry.findUnique({
      where: { classId_userId: { classId, userId } },
    });
    if (existingWaitlist) {
      throw new ApiValidationError("Ya estás en la lista de espera", 400);
    }

    return this.prisma.waitlistEntry.create({ data: { classId, userId } });
  }

  async leaveWaitlist(userId: string, classId: number) {
    const existingWaitlist = await this.prisma.waitlistEntry.findUnique({
      where: { classId_userId: { classId, userId } },
    });

    if (!existingWaitlist) {
      throw new ApiValidationError("No estabas en la lista de espera de esta clase", 404);
    }

    await this.prisma.waitlistEntry.delete({
      where: { id: existingWaitlist.id },
    });

    return { classId, userId };
  }

  async getUserWaitlistEntries(userId: string, sedeId?: number) {
    const recentClassesStart = this.getRecentClassesStartDate();
    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        userId,
        ...(sedeId ? { class: { sedeId } } : {}),
      },
      include: {
        class: true,
      },
      orderBy: [{ class: { date: "asc" } }, { createdAt: "desc" }],
    });

    return entries.filter(
      (entry) => this.getClassStartDateTime(entry.class) >= recentClassesStart
    ).map((entry) => ({
      id: `waitlist-${entry.id}`,
      classId: entry.classId,
      userId: entry.userId,
      status: BookingStatus.WAITLIST,
      createdAt: entry.createdAt,
      class: entry.class,
      waitlistEntryId: entry.id,
    }));
  }

  async getClassBookings(classId: number, status?: BookingStatus) {
    const classData = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!classData) {
      throw new ApiValidationError("Class not found", 404);
    }

    return this.prisma.booking.findMany({
      where: { classId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  private async awardPointsForPromotedWaitlistBooking(promotedBooking: {
    userId: string;
    classId: number;
  } | null) {
    if (!promotedBooking) return null;

    try {
      const cls = await this.prisma.class.findUnique({
        where: { id: promotedBooking.classId },
        select: { id: true, sedeId: true },
      });
      if (!cls) return null;

      const existingEvent = await this.prisma.pointEvent.findFirst({
        where: {
          userId: promotedBooking.userId,
          classId: promotedBooking.classId,
          type: PointEventType.CLASS_ENROLL,
        },
      });
      if (existingEvent) {
        return {
          promoted: true,
          userId: promotedBooking.userId,
          classId: promotedBooking.classId,
          pointsGranted: false,
          pointsAwarded: 0,
          reason: "existing_event",
        };
      }

      const event = await PointsService.registerEvent({
        userId: promotedBooking.userId,
        sedeId: cls.sedeId,
        type: PointEventType.CLASS_ENROLL,
        classId: cls.id,
      });

      return {
        promoted: true,
        userId: promotedBooking.userId,
        classId: promotedBooking.classId,
        pointsGranted: true,
        pointsAwarded: event.points,
      };
    } catch {
      return {
        promoted: true,
        userId: promotedBooking.userId,
        classId: promotedBooking.classId,
        pointsGranted: false,
        pointsAwarded: 0,
        reason: "points_error",
      };
    }
  }

  private async increaseNoShowCounter(userId: string, when: Date, tx?: PrismaClient | any) {
    const client = tx ?? this.prisma;
    const existing = await client.userBookingPenalty.upsert({
      where: { userId },
      create: { userId, strikes: 0, restrictedUntil: null },
      update: {},
    });

    if (
      existing.restrictedUntil &&
      new Date(existing.restrictedUntil).getTime() > when.getTime()
    ) {
      return;
    }

    const nextStrikes = (existing.strikes ?? 0) + 1;

    if (nextStrikes >= NO_SHOW_POLICY.restrictedAt) {
      await client.userBookingPenalty.update({
        where: { userId },
        data: {
          strikes: 0,
          restrictedUntil: this.addMinutes(when, NO_SHOW_POLICY.restrictionMinutes),
        },
      });
      return;
    }

    await client.userBookingPenalty.update({
      where: { userId },
      data: {
        strikes: nextStrikes,
        restrictedUntil: null,
      },
    });
  }

  async updateBookingStatus(bookingId: number, status: BookingStatus) {
    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) {
        throw new ApiValidationError("Booking not found", 404);
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status,
          cancelledAt: status === BookingStatus.CANCELLED ? new Date() : booking.cancelledAt,
          checkedInAt: status === BookingStatus.ATTENDED ? new Date() : booking.checkedInAt,
        },
      });

      if (status === BookingStatus.ABSENT && booking.status !== BookingStatus.ABSENT) {
        await this.increaseNoShowCounter(booking.userId, new Date(), tx);
      }

      let promotedBooking: { userId: string; classId: number } | null = null;
      if (status === BookingStatus.CANCELLED) {
        promotedBooking = await this.promoteWaitlistIfPossible(booking.classId, tx);
      }

      await this.syncClassEnrollment(booking.classId, tx);

      return { updated, promotedBooking };
    });

    await this.awardPointsForPromotedWaitlistBooking(result.promotedBooking);

    return result.updated;
  }

  async updateAttendanceStatusByAdmin(bookingId: number, status: BookingStatus) {
    if (status !== BookingStatus.ATTENDED && status !== BookingStatus.ABSENT) {
      throw new ApiValidationError(
        "Solo se puede registrar ATTENDED o ABSENT en la toma de asistencia",
        400
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { class: true },
      });

      if (!booking) {
        throw new ApiValidationError("Booking not found", 404);
      }

      if (booking.status !== BookingStatus.RESERVED) {
        throw new ApiValidationError(
          "La reserva ya fue procesada o no está pendiente de asistencia",
          409
        );
      }

      const classStart = this.getClassStartDateTime(booking.class);
      if (new Date() < classStart) {
        throw new ApiValidationError(
          "La asistencia solo puede registrarse una vez finalizada la clase",
          409
        );
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status,
          checkedInAt: status === BookingStatus.ATTENDED ? new Date() : booking.checkedInAt,
        },
        include: { class: true },
      });

      if (status === BookingStatus.ABSENT) {
        await this.increaseNoShowCounter(booking.userId, updated.updatedAt, tx);
      }

      await this.syncClassEnrollment(booking.classId, tx);

      return updated;
    });

    let strikeAlert: null | {
      type: "ABSENT_STRIKE";
      userId: string;
      strikes: number;
      threshold: number;
      isRestricted: boolean;
      restrictionUntil: Date | null;
    } = null;

    if (status === BookingStatus.ABSENT) {
      const summary = await this.getBookingStrikeSummary(result.userId);
      strikeAlert = {
        type: "ABSENT_STRIKE",
        userId: result.userId,
        strikes: summary.strikesInWindow,
        threshold: NO_SHOW_POLICY.restrictedAt,
        isRestricted: summary.restricted,
        restrictionUntil: summary.restrictionUntil,
      };
    }

    return { updated: result, strikeAlert };
  }
}

export default new BookingService();
