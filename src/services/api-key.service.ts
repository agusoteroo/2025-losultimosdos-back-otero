import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { ApiValidationError } from "./api-validation-error";

const BCRYPT_ROUNDS = 10;

class ApiKeyService {
  private readonly prisma: PrismaClient;
  private readonly KEY_PREFIX = "mk_live_";
  private readonly KEY_LENGTH = 32;

  constructor() {
    this.prisma = new PrismaClient();
  }

  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(this.KEY_LENGTH);
    const randomString = randomBytes.toString("hex");
    return `${this.KEY_PREFIX}${randomString}`;
  }

  async create(userId: string) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ApiValidationError("User already has an API key", 409);
    }

    const plainKey = this.generateApiKey();
    const hashed = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        keyHash: hashed,
      },
    });

    return {
      id: apiKey.id,
      key: plainKey,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      lastUsed: apiKey.lastUsed,
    };
  }

  async getByUserId(userId: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { userId },
    });

    if (!apiKey) {
      return null;
    }

    return {
      id: apiKey.id,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      lastUsed: apiKey.lastUsed,
    };
  }

  async regenerate(keyId: string, userId: string) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!existing) {
      throw new ApiValidationError("API key not found", 404);
    }

    if (existing.userId !== userId) {
      throw new ApiValidationError("API key doesn't belong to user", 403);
    }

    const plainKey = this.generateApiKey();
    const hashed = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);

    const apiKey = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        keyHash: hashed,
        lastUsed: null,
        updatedAt: new Date(),
      },
    });

    return {
      id: apiKey.id,
      key: plainKey,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      lastUsed: apiKey.lastUsed,
    };
  }

  async toggleStatus(keyId: string, userId: string, isActive: boolean) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!existing) {
      throw new ApiValidationError("API key not found", 404);
    }

    if (existing.userId !== userId) {
      throw new ApiValidationError("API key doesn't belong to user", 403);
    }

    const apiKey = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive },
    });

    return {
      id: apiKey.id,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      lastUsed: apiKey.lastUsed,
    };
  }

  async delete(keyId: string, userId: string) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!existing) {
      throw new ApiValidationError("API key not found", 404);
    }

    if (existing.userId !== userId) {
      throw new ApiValidationError("API key doesn't belong to user", 403);
    }

    await this.prisma.apiKey.delete({
      where: { id: keyId },
    });
  }

  async validateKey(plainKey: string): Promise<{ userId: string } | null> {
    if (!plainKey || !plainKey.startsWith(this.KEY_PREFIX)) {
      return null;
    }

    const activeKeys = await this.prisma.apiKey.findMany({
      where: { isActive: true },
    });

    for (const apiKey of activeKeys) {
      const isMatch = await bcrypt.compare(plainKey, apiKey.keyHash);
      if (isMatch) {
        await this.prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsed: new Date() },
        });
        return { userId: apiKey.userId };
      }
    }

    return null;
  }
}

export default new ApiKeyService();