import { BookingStatus, PrismaClient } from "@prisma/client";
import { ApiValidationError } from "./api-validation-error";
import UserService from "./user.service";

const NO_SHOW_POLICY = {
  cancellationWindowHours: 4,
  maxMonthlyNoShows: 3,
  restrictedAt: 3,
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

  private async ensureNoShowRestriction(userId: string) {
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
          status: { in: [BookingStatus.RESERVED, BookingStatus.ATTENDED] },
        },
      });

      if (existing || classData.users.includes(userId)) {
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
    return this.prisma.$transaction(async (tx) => {
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

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      });

      await this.promoteWaitlistIfPossible(classId, tx);
      await this.syncClassEnrollment(classId, tx);

      return tx.class.findUniqueOrThrow({ where: { id: classId } });
    });
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
    return this.prisma.booking.findMany({
      where: {
        userId,
        ...(sedeId ? { class: { sedeId } } : {}),
      },
      include: {
        class: true,
      },
      orderBy: [{ class: { date: "asc" } }, { createdAt: "desc" }],
    });
  }

  async getNoShowPolicy(userId: string) {
    const { start } = this.getMonthRange();
    const noShow = await this.prisma.userNoShowMonthly.findUnique({
      where: { userId_monthStart: { userId, monthStart: start } },
    });

    const count = noShow?.count ?? 0;
    return {
      ...NO_SHOW_POLICY,
      currentMonth: {
        monthStart: start,
        noShows: count,
        restricted: count >= NO_SHOW_POLICY.restrictedAt,
        remainingBeforeRestriction: Math.max(NO_SHOW_POLICY.restrictedAt - count, 0),
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
        status: { in: [BookingStatus.RESERVED, BookingStatus.ATTENDED] },
      },
    });
    if (existingBooking) {
      throw new ApiValidationError("Ya tenés una reserva para esta clase", 400);
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

  async getClassBookings(classId: number) {
    const classData = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!classData) {
      throw new ApiValidationError("Class not found", 404);
    }

    return this.prisma.booking.findMany({
      where: { classId },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  private async increaseNoShowCounter(userId: string, when: Date, tx?: PrismaClient | any) {
    const client = tx ?? this.prisma;
    const { start } = this.getMonthRange(when);

    await client.userNoShowMonthly.upsert({
      where: { userId_monthStart: { userId, monthStart: start } },
      create: { userId, monthStart: start, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  async updateBookingStatus(bookingId: number, status: BookingStatus) {
    return this.prisma.$transaction(async (tx) => {
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

      if (status === BookingStatus.CANCELLED) {
        await this.promoteWaitlistIfPossible(booking.classId, tx);
      }

      await this.syncClassEnrollment(booking.classId, tx);

      return updated;
    });
  }
}

export default new BookingService();
