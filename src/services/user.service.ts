import { clerkClient, User } from "@clerk/express";
import { ApiValidationError } from "./api-validation-error";
import { PrismaClient } from "@prisma/client";
import ClassService from "./class.service";
import RoutineService from "./routine.service";

class UserService {
  private readonly prisma: PrismaClient;
  constructor() {
    this.prisma = new PrismaClient();
  }
  async getUsers() {
    return await clerkClient.users.getUserList({
      limit: 100,
    });
  }

  async getUserById(userId: string) {
    try {
      const user = await clerkClient.users.getUser(userId);

      return this.sanitizeUser(user);
    } catch (error: any) {
      if (error?.message === "Not Found") {
        throw new ApiValidationError(`User with ID ${userId} not found`, 404);
      }
      throw error;
    }
  }

  async getUsersBySedeId(sedeId: number) {
    const users = await clerkClient.users.getUserList({ limit: 100 });
    const filteredUsers = users.data.filter(
      (user) => user.publicMetadata.sede === sedeId
    );
    return filteredUsers;
  }
  async updateUserRole(userId: string, role: string) {
    if (role !== "admin" && role !== "user") {
      throw new ApiValidationError("Invalid role", 400);
    }
    const user = await clerkClient.users.getUser(userId);
    return await clerkClient.users.updateUser(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        role,
      },
    });
  }

  async updateUserPlan(userId: string, plan: string) {
    if (plan !== "basic" && plan !== "premium") {
      throw new ApiValidationError(
        "Invalid plan. Must be either 'basic' or 'premium'",
        400
      );
    }
    const user = await clerkClient.users.getUser(userId);
    return await clerkClient.users.updateUser(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        plan,
      },
    });
  }

  async getDailyUserCount(sedeId: number) {
    const dailyUserCount = await this.prisma.dailyUserCount.findMany({
      orderBy: {
        date: "desc",
      },
      where: {
        date: {
          lt: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        sedeId,
      },
      take: 90,
    });

    const users = await this.getUsers();
    const basic = users.data.filter(
      (user) =>
        user.publicMetadata.plan === "basic" &&
        user.publicMetadata.sede === sedeId
    ).length;
    const premium = users.data.filter(
      (user) =>
        user.publicMetadata.plan === "premium" &&
        user.publicMetadata.sede === sedeId
    ).length;

    return [
      ...dailyUserCount,
      {
        date: new Date(),
        basic,
        premium,
      },
    ];
  }
  sanitizeUser(user: User) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.emailAddresses[0]?.emailAddress,
      imageUrl: user.imageUrl,
      createdAt: user.createdAt,
      role: user.publicMetadata.role as string,
      plan: user.publicMetadata.plan as string,
      sedeId: user.publicMetadata.sede as number,
    };
  }
  async updateUserSede(userId: string, sedeId: number) {
    const user = await clerkClient.users.getUser(userId);

    const classes = await ClassService.getClassByUserId(userId);
    const routines = await RoutineService.getByUserId(userId);
    if (classes.length > 0 || routines.length > 0) {
      throw new ApiValidationError("User has classes or routines", 400);
    }

    return await clerkClient.users.updateUser(userId, {
      publicMetadata: { ...user.publicMetadata, sede: sedeId },
    });
  }

  async hasMedicalCheck(userId: string) {
    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata.medicalCheck) {
      return true;
    }

    try {
      console.log("Checking medical check for user", { userId });
      const response = await fetch(
        `${process.env.MEDIBOOK_PUBLIC_URL}/health-certificate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MEDIBOOK_API_KEY}`,
          },
          body: JSON.stringify({
            email: user.emailAddresses[0]?.emailAddress,
          }),
        }
      );
      const data = await response.json();

      if (data.hasHealthCertificate) {
        console.log("User has health certificate", { userId });
        await clerkClient.users.updateUser(userId, {
          publicMetadata: { ...user.publicMetadata, medicalCheck: true },
        });
        return true;
      }
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.log("Error checking medical check", { userId, message });
      return false;
    }
  }
}

export default new UserService();
