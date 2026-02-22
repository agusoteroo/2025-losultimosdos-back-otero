import { BookingStatus, Class, PrismaClient } from "@prisma/client";
import { ApiValidationError } from "./api-validation-error";
import UserService from "./user.service";
import PointsService from "./points.service";
import { PointEventType } from "@prisma/client";
import BadgeService from "./badge.service";
import BookingService from "./booking.service";
class ClassService {
  private readonly prisma: PrismaClient;
  constructor() {
    this.prisma = new PrismaClient();
  }

  private getRecentClassesStartDate() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  }

  private getClassDateTime(classItem: { date: Date; time: string }) {
    const dateTime = new Date(classItem.date);
    const match =
      typeof classItem.time === "string"
        ? classItem.time.match(/^(\d{1,2}):(\d{2})/)
        : null;

    if (!match) return dateTime;

    dateTime.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return dateTime;
  }

  private startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async getAllClasses() {
    const now = new Date();
    const classes = await this.prisma.class.findMany({
      where: {
        date: {
          gte: this.startOfDay(now),
        },
      },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    return classes.filter((cls) => this.getClassDateTime(cls) >= now);
  }

  async getAllClassesBySedeId(sedeId: number) {
    const now = new Date();

    const classes = await this.prisma.class.findMany({
      where: { sedeId, date: { gte: this.startOfDay(now) } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    return classes.filter((cls) => this.getClassDateTime(cls) >= now);
  }

  async getRecentAndFutureClassesBySedeId(sedeId: number) {
    const recentClassesStart = this.getRecentClassesStartDate();
    const classes = await this.prisma.class.findMany({
      where: { sedeId, date: { gte: this.startOfDay(recentClassesStart) } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    return classes.filter(
      (cls) => this.getClassDateTime(cls) >= recentClassesStart
    );
  }

  async getPendingAttendanceClassesBySedeId(sedeId: number) {
    const now = new Date();
    const recentClassesStart = this.getRecentClassesStartDate();
    const classes = await this.prisma.class.findMany({
      where: {
        sedeId,
        date: { gte: this.startOfDay(recentClassesStart) },
        bookings: {
          some: {
            status: BookingStatus.RESERVED,
          },
        },
      },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    return classes.filter((cls) => {
      const classDateTime = this.getClassDateTime(cls);
      return classDateTime >= recentClassesStart && classDateTime <= now;
    });
  }

  async getClassById(id: number) {
    
    return this.prisma.class.findUnique({ where: { id } });
  }

  async getClassByUserId(userId: string) {
    const recentClassesStart = this.getRecentClassesStartDate();
    const classes = await this.prisma.class.findMany({
      where: {
        bookings: {
          some: {
            userId,
            status: {
              in: [
                BookingStatus.RESERVED,
                BookingStatus.ATTENDED,
                BookingStatus.ABSENT,
                BookingStatus.CANCELLED,
              ],
            },
          },
        },
        date: { gte: this.startOfDay(recentClassesStart) },
      },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    return classes.filter(
      (cls) => this.getClassDateTime(cls) >= recentClassesStart
    );
  }

  private async getFutureClassCount(userId: string): Promise<number> {
    const classes = await this.prisma.booking.count({
      where: {
        userId,
        status: "RESERVED",
        class: { date: { gte: new Date() } },
      },
    });
    return classes;
  }

  async createClass(classData: Omit<Class, "id" | "users" | "enrolled">) {
    return this.prisma.class.create({
      data: {
        ...classData,
      },
    });
  }

  async updateClass(id: number, data: Omit<Class, "id" | "createdById">) {
    const classData = await this.getClassById(id);
    if (!classData) {
      throw new ApiValidationError("Class not found", 404);
    }

    return this.prisma.class.update({ where: { id }, data });
  }

  async deleteClass(id: number) {
    const classData = await this.getClassById(id);
    if (!classData) {
      throw new ApiValidationError("Class not found", 404);
    }
    return this.prisma.class.delete({ where: { id } });
  }

  async enrollClass(userId: string, classId: number) {
    const { updatedClass: updated } = await BookingService.createBookingFromEnroll(
      userId,
      classId,
    );
    try {
      const event = await PointsService.registerEvent({
        userId,
        sedeId: updated.sedeId,
        type: PointEventType.CLASS_ENROLL,
        classId: updated.id,
      });
      return { updated, pointsAwarded: event.points };
    } catch {
      return { updated, pointsAwarded: 0 };
    }
  }
  async unenrollClass(userId: string, classId: number) {
    const { updatedClass: updated, promotionAlert } =
      await BookingService.cancelBookingFromUnenroll(
      userId,
      classId,
    );
    try {
      await PointsService.removeClassEnrollEvent(userId, classId);
    } catch {
      // noop
    }
    try {
      await BadgeService.evaluateForUser(userId, updated.sedeId);
    } catch {
      // noop
    }
    return { updated, promotionAlert };
  }
  async listNamesWithEnrollCount(
    upcoming = false,
  ): Promise<
    { name: string; enrollCount: number; sede: { id: number; name: string } }[]
  > {
    const where = upcoming ? { date: { gte: new Date() } } : undefined;

    const rows = await this.prisma.class.findMany({
      where: { ...where },
      select: {
        name: true,
        enrolled: true,
        sede: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    return rows.map((c) => ({
      name: c.name,
      enrollCount: c.enrolled ?? 0,
      sede: { id: c.sede.id, name: c.sede.name },
    }));
  }

  async enrollmentsByHour(upcoming = true): Promise<
    {
      sedeId: number;
      sedeName: string;
      hours: { hour: string; total: number }[];
    }[]
  > {
    const where = upcoming ? { date: { gte: new Date() } } : undefined;

    const rows = await this.prisma.class.findMany({
      where,
      select: {
        time: true,
        enrolled: true,
        sedeId: true,
        sede: {
          select: {
            name: true,
          },
        },
      },
    });

    const sedeBuckets = new Map<
      number,
      { name: string; hourBuckets: Map<string, number> }
    >();

    for (const r of rows) {
      const match =
        typeof r.time === "string" ? r.time.match(/^(\d{1,2})/) : null;
      if (!match) continue;

      const hour = match[1].padStart(2, "0");

      if (!sedeBuckets.has(r.sedeId)) {
        sedeBuckets.set(r.sedeId, {
          name: r.sede.name,
          hourBuckets: new Map<string, number>(),
        });
      }

      const sedeData = sedeBuckets.get(r.sedeId)!;
      const curr = sedeData.hourBuckets.get(hour) ?? 0;
      sedeData.hourBuckets.set(hour, curr + (r.enrolled ?? 0));
    }

    const items = Array.from(sedeBuckets, ([sedeId, sedeData]) => {
      const hours = Array.from(sedeData.hourBuckets, ([hour, total]) => ({
        hour,
        total,
      })).sort((a, b) => b.total - a.total || a.hour.localeCompare(b.hour));

      return {
        sedeId,
        sedeName: sedeData.name,
        hours,
      };
    }).sort((a, b) => a.sedeId - b.sedeId);

    return items;
  }
}

export default new ClassService();
