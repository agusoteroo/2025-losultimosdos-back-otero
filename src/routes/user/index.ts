import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { ApiValidationError } from "../../services/api-validation-error";
import checkUserRole from "../../middleware/user";
import { ClassEnrollment } from "../../types/class";
import { validateBody, validateParams } from "../../middleware/validation";
import { classEnrollmentSchema } from "../../schemas/class.schema";
import ClassService from "../../services/class.service";
import UserService from "../../services/user.service";
import { asyncHandler } from "../../middleware/asyncHandler";
import RoutineService from "../../services/routine.service";
import BadgeService from "../../services/badge.service";
import {
  PointEventType,
  PrismaClient,
  ChallengeFrequency,
} from "@prisma/client";
import ExercisePerformanceService from "../../services/exercisePerformance.service";
import PointsService from "../../services/points.service";
import ChallengeService from "../../services/challenge.service"; 
import ActivityService from "../../services/activity.service";
import BookingService from "../../services/booking.service";
import {
  bookingIdParamSchema,
  waitlistSchema,
} from "../../schemas/booking.schema";

const router = Router();
const prisma = new PrismaClient(); // 👈 para el calendario

router.use(checkUserRole);

router.get("/", (_req: Request, res: Response) => {
  res.json({ message: "User dashboard" });
});

router.post(
  "/enroll",
  validateBody(classEnrollmentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { classId } = req.body as ClassEnrollment;
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const data = await ClassService.enrollClass(userId, classId);
    res.json({
      message: "Enrolled successfully",
      class: data.updated,
      pointsAwarded: data.pointsAwarded,
    });
  })
);

router.post(
  "/unenroll",
  validateBody(classEnrollmentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { classId } = req.body as ClassEnrollment;
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const updatedClass = await ClassService.unenrollClass(userId, classId);
    res.json({ message: "Unenrolled successfully", class: updatedClass });
  })
);
router.get(
  "/bookings",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const sedeIdParam = req.query.sedeId;
    const sedeId = sedeIdParam ? Number(sedeIdParam) : undefined;
    if (sedeIdParam && Number.isNaN(sedeId)) {
      throw new ApiValidationError("Invalid sedeId", 400);
    }

    const items = await BookingService.getUserBookings(userId, sedeId);
    res.json({ items });
  })
);

router.get(
  "/bookings/no-show-policy",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const policy = await BookingService.getNoShowPolicy(userId);
    res.json(policy);
  })
);

router.post(
  "/bookings/:bookingId/check-in",
  validateParams(bookingIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const bookingId = Number(req.params.bookingId);
    const booking = await BookingService.checkIn(userId, bookingId);

    res.status(200).json({ message: "Check-in registrado", booking });
  })
);

router.post(
  "/bookings/waitlist",
  validateBody(waitlistSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const { classId } = req.body as { classId: number };
    const entry = await BookingService.joinWaitlist(userId, classId);

    res.status(201).json({ message: "Te anotaste en lista de espera", entry });
  })
);

router.get(
  "/my-classes",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }
    const classes = await ClassService.getClassByUserId(userId);
    res.json({ classes });
  })
);

router.get(
  "/badges",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const user = await UserService.getUserById(userId);
    const badges = await BadgeService.getUserBadges(userId, user.sedeId);

    res.json({ items: badges });
  })
);

router.post(
  "/badges/evaluate",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const user = await UserService.getUserById(userId);
    const newlyEarnedBadges = await BadgeService.evaluateAndReturnNew(
      userId,
      user.sedeId
    );

    res.json({ items: newlyEarnedBadges });
  })
);

router.get(
  "/routines",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }
    const routines = await RoutineService.getByUserId(userId);
    res.json({ routines });
  })
);

router.post(
  "/routines/:id/complete",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const routineId = Number(req.params.id);
    const { performances } = req.body as {
      performances: { exerciseId: number; weight: number; reps: number }[];
    };

    if (!Array.isArray(performances) || performances.length === 0) {
      return res.status(400).json({ error: "No performances provided" });
    }

    await ExercisePerformanceService.logPerformances({
      userId,
      routineId,
      performances,
    });

    const routine = await RoutineService.getById(routineId);
    if (!routine) {
      return res.status(404).json({ error: "Routine not found" });
    }

    const totalExercises = routine.exercises.length || 1;

    const completedExerciseIds = Array.from(
      new Set(performances.map((p) => p.exerciseId))
    );
    const completedCount = completedExerciseIds.length;
    const completionRatio = Math.min(
      Math.max(completedCount / totalExercises, 0),
      1
    );

    const duration = routine.duration ?? 30;
    const basePointsPer10Min = 20;
    const baseByDuration = (duration / 10) * basePointsPer10Min;

    const pointsAwarded = Math.round(baseByDuration * completionRatio);
    let finalPointsAwarded = pointsAwarded;
    if (pointsAwarded !== 0) {
      const event = await PointsService.registerEvent({
        userId,
        sedeId: routine.sedeId,
        type: PointEventType.ROUTINE_COMPLETE,
        routineId: routine.id,
        customPoints: pointsAwarded,
      });
      finalPointsAwarded = event.points;
    }

    res.status(201).json({
      ok: true,
      pointsAwarded: finalPointsAwarded,
      completionRatio,
      completedCount,
      totalExercises,
    });
  })
);

router.post(
  "/challenges/evaluate",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const user = await UserService.getUserById(userId);
    const newlyCompleted = await ChallengeService.evaluateAndReturnNew(
      userId,
      user.sedeId
    );

    res.json({ items: newlyCompleted });
  })
);

router.get(
  "/training-days",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const now = new Date();
    const yearParam = req.query.year;
    const monthParam = req.query.month;

    const year = yearParam ? Number(yearParam) : now.getFullYear();
    const month = monthParam ? Number(monthParam) : now.getMonth() + 1; // 1–12

    if (Number.isNaN(year) || Number.isNaN(month)) {
      throw new ApiValidationError("Invalid year or month", 400);
    }

    const result = await ActivityService.getTrainingDays({
      userId,
      year,
      month,
    });

    res.json(result); // { year, month, trainingDays: ["YYYY-MM-DD", ...] }
  })
);

router.get(
  "/challenges",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) {
      throw new ApiValidationError("Unauthorized", 401);
    }

    const rawFrequency = String(req.query.frequency ?? "daily").toUpperCase();
    if (!["DAILY", "WEEKLY"].includes(rawFrequency)) {
      throw new ApiValidationError("Invalid frequency", 400);
    }
    const frequency = rawFrequency as ChallengeFrequency;

    const sedeIdParam = req.query.sedeId;
    const sedeId = sedeIdParam ? Number(sedeIdParam) : undefined;
    if (sedeIdParam && Number.isNaN(sedeId)) {
      throw new ApiValidationError("Invalid sedeId", 400);
    }

    const challenges = await ChallengeService.listForUser({
      userId,
      sedeId,
      frequency,
    });

    res.json({ challenges });
  })
);

router.get(
  "/:userId",
  asyncHandler(async (req: Request, res: Response) => {
    const auth = getAuth(req);
    if (!auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { userId } = req.params;
    if (auth.userId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const user = await UserService.getUserById(userId);
    res.json(user);
  })
);

export default router;
