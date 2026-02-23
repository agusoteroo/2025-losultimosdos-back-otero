import { BookingStatus } from "@prisma/client";
import { z } from "zod";

export const bookingIdParamSchema = z.object({
  bookingId: z.string().regex(/^\d+$/, "bookingId must be numeric"),
});

export const classIdParamSchema = z.object({
  classId: z.string().regex(/^\d+$/, "classId must be numeric"),
});

export const waitlistSchema = z.object({
  classId: z.number().int().positive(),
});

export const bookingStatusSchema = z.object({
  status: z.nativeEnum(BookingStatus),
});
