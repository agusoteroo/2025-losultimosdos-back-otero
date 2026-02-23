import express, { Request, Response, NextFunction } from "express";
import cron from "node-cron";
import { asyncHandler } from "./middleware/asyncHandler";
import validateApiKey from "./middleware/api-key-auth";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { clerkClient, clerkMiddleware, getAuth } from "@clerk/express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { PrismaClient } from "@prisma/client";
import { WebhookEvent } from "@clerk/backend";
import adminRoutes from "./routes/admin/index";
import userRoutes from "./routes/user/index";
import apiKeyRoutes from "./routes/api-keys";
import gamificationRoutes from "./routes/gamification/index";
import ClassService from "./services/class.service";
import { ApiValidationError } from "./services/api-validation-error";
import ExerciseService from "./services/excersice.service";
import RoutineService from "./services/routine.service";
import { validateParams } from "./middleware/validation";
import { routineIdParamSchema } from "./schemas/routine.schema";
import UserService from "./services/user.service";
dotenv.config();
import PointsService from "./services/points.service";
import ExercisePerformanceService from "./services/exercisePerformance.service";

const prisma = new PrismaClient();
const app = express();

const sanitizeForLogging = (value: unknown): unknown => {
  const sensitiveExact = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "apikey",
    "x-auth-token",
    "password",
    "token",
    "refreshToken",
    "secret",
    "clientSecret",
    "accessToken",
  ].map((k) => k.toLowerCase()));

  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth = 0): unknown => {
    if (input === null || input === undefined) return input;
    if (typeof input !== "object") return input;
    if (depth > 5) return "[MaxDepth]";

    if (seen.has(input as object)) return "[Circular]";
    seen.add(input as object);

    if (Array.isArray(input)) return input.map((v) => walk(v, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        sensitiveExact.has(lower) ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password")
      ) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = walk(v, depth + 1);
      }
    }
    return out;
  };

  return walk(value);
};

const checkIsAuthenticated = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

app.post(
  "/api/webhooks",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const evt = (await verifyWebhook(req)) as WebhookEvent;
      const eventType = evt.type;

      if (eventType === "user.created") {
        const { id } = evt.data;

        try {
          await clerkClient.users.updateUser(id, {
            publicMetadata: {
              role: "user",
              plan: "basic",
              sede: "1",
              medicalCheck: false,
            },
          });
          console.log(`User ${id} assigned role: user`);
          res
            .status(200)
            .json({ success: true, message: "Role assigned successfully" });
        } catch (error) {
          console.error(`Error assigning role to user ${id}:`, error);
          res
            .status(500)
            .json({ success: false, message: "Failed to assign role" });
        }
      }
    } catch (err) {
      console.error("Error verifying webhook:", err);
      return res.status(400).send("Error verifying webhook");
    }
  }
);

cron.schedule("0 0 * * *", async () => {
  console.log("Running daily user count job...");

  try {
    const users = await clerkClient.users.getUserList({
      limit: 100,
    });

    const basic = users.data.filter(
      (user) => user.publicMetadata.plan === "basic"
    ).length;
    const premium = users.data.filter(
      (user) => user.publicMetadata.plan === "premium"
    ).length;

    await prisma.dailyUserCount.create({
      data: {
        date: new Date(),
        basic,
        premium,
      },
    });

    console.log(" User count saved:", basic, premium);
  } catch (err) {
    console.error("Error saving user count:", err);
  }
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || [],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

app.post(
  "/isUser",
  validateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { mail: string };
    if (!body.mail) {
      return res.status(400).json({ error: "Mail is required" });
    }
    const users = await clerkClient.users.getUserList({
      emailAddress: [body.mail],
    });

    if (users.data.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = users.data[0];
    res.status(200).json({ isUser: user.publicMetadata.role === "user" });
  })
);

app.post(
  "/medical-check",
  validateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { email: string; medicalCheck: boolean };
    if (!body.email) {
      return res.status(400).json({ error: "User ID is required" });
    }
    if (!body.medicalCheck) {
      return res.status(400).json({ error: "Medical check is required" });
    }
    const user = await clerkClient.users.getUserList({
      emailAddress: [body.email],
    });
    if (user.data.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    await clerkClient.users.updateUser(user.data[0].id, {
      publicMetadata: {
        ...user.data[0].publicMetadata,
        medicalCheck: body.medicalCheck,
      },
    });
    res.status(200).json({ message: "Medical check updated" });
  })
);

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(clerkMiddleware());

app.use("/admin", adminRoutes);
app.use("/user", userRoutes);
app.use("/api-keys", apiKeyRoutes);
app.use("/gamification", gamificationRoutes);

app.use(checkIsAuthenticated);
app.get(
  "/classes",
  asyncHandler(async (req: Request, res: Response) => {
    const sedeId = Number(req.query.sedeId);
    if (!sedeId) {
      throw new ApiValidationError("Sede ID is required", 400);
    }
    const classes = await ClassService.getAllClassesBySedeId(sedeId);
    res.json({ classes });
  })
);

app.get(
  "/exercises",
  asyncHandler(async (req: Request, res: Response) => {
    const { q, muscleGroupId } = req.query as any;
    const items = await ExerciseService.list({
      q: q as string | undefined,
      muscleGroupId: muscleGroupId ? Number(muscleGroupId) : undefined,
    });
    res.json({ total: items.length, items });
  })
);

app.get(
  "/routines",
  asyncHandler(async (req: Request, res: Response) => {
    const sedeId = Number(req.query.sedeId);
    if (!sedeId) {
      throw new ApiValidationError("Sede ID is required", 400);
    }
    const items = await RoutineService.list(sedeId);

    res.json({ total: items.length, items });
  })
);

app.get(
  "/routines/users-count",
  asyncHandler(async (req, res) => {
    const items = await RoutineService.listNamesWithUsersCount();

    res.json({ total: items.length, items });
  })
);

app.get(
  "/routines/:id(\\d+)",
  validateParams(routineIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const r = await RoutineService.getById(id);
    if (!r) throw new ApiValidationError("Routine not found", 404);
    res.json(r);
  })
);
app.get(
  "/classes/busiest-hour",
  asyncHandler(async (req, res) => {
    const upcoming =
      String(req.query.upcoming ?? "true").toLowerCase() === "true";

    const items = await ClassService.enrollmentsByHour(upcoming);

    res.json({
      total: items.length,
      items,
    });
  })
);

app.get(
  "/classes/enrollments-count",
  asyncHandler(async (req, res) => {
    const upcoming =
      String(req.query.upcoming ?? "false").toLowerCase() === "true";
    const items = await ClassService.listNamesWithEnrollCount(upcoming);
    res.json({ total: items.length, items });
  })
);

app.get(
  "/daily-user-count",
  asyncHandler(async (req: Request, res: Response) => {
    const sedeId = Number(req.query.sedeId);
    if (!sedeId) {
      throw new ApiValidationError("Sede ID is required", 400);
    }
    const dailyUserCount = await UserService.getDailyUserCount(sedeId);
    res.json({
      data: dailyUserCount,
    });
  })
);
app.get(
  "/user/routines/:id/best-performances",
  clerkMiddleware(),
  asyncHandler(async (req, res) => {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const routineId = Number(req.params.id);
    const routine = await RoutineService.getById(routineId);
    if (!routine) {
      return res.status(404).json({ error: "Routine not found" });
    }

    const exerciseIds = routine.exercises.map((re) => re.exerciseId);

    const best = await ExercisePerformanceService.getBestByUserAndExercises({
      userId,
      exerciseIds,
    });

    res.json({ items: best });
  })
);

app.get(
  "/sedes",
  asyncHandler(async (_req: Request, res: Response) => {
    const sedes = await prisma.sede.findMany();
    res.json({
      sedes: sedes.map((sede) => ({
        id: sede.id,
        name: sede.name,
        address: sede.address,
        latitude: sede.latitude,
        longitude: sede.longitude,
      })),
    });
  })
);

app.get(
  "/leaderboard/users",
  asyncHandler(async (req, res) => {
    const period = (req.query.period as "all" | "30d" | "7d") ?? "all";
    const sedeId = req.query.sedeId
      ? Number(req.query.sedeId as string)
      : undefined;

    const items = await PointsService.userLeaderboard({ period, sedeId });

    res.json({ total: items.length, items });
  })
);

app.get(
  "/leaderboard/sedes",
  asyncHandler(async (req, res) => {
    const period = (req.query.period as "all" | "30d" | "7d") ?? "all";

    const items = await PointsService.sedeLeaderboard({ period });

    res.json({ total: items.length, items });
  })
);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const isProd = process.env.NODE_ENV === "production";
  const sanitizedHeaders = { ...req.headers } as Record<string, unknown>;
  for (const key of ["authorization", "cookie", "x-api-key"]) {
    if (key in sanitizedHeaders) {
      sanitizedHeaders[key] = "[REDACTED]";
    }
  }

  console.error("[Error Handler]", {
    error: err.message,
    stack: isProd ? undefined : err.stack,
    path: req.path,
    method: req.method,
    headers: sanitizedHeaders,
    query: sanitizeForLogging(req.query),
    params: sanitizeForLogging(req.params),
    body: sanitizeForLogging(req.body),
  });

  if (err instanceof ApiValidationError) {
    console.log("[Error Handler] ApiValidationError:", {
      statusCode: err.statusCode,
      message: err.message,
    });
    res.status(err.statusCode).json({
      error: err.message,
      details: [{ path: "", message: err.message }],
    });
  } else {
    console.error("[Error Handler] Unexpected error:", err);
    res.status(500).json({
      error: "Something went wrong!",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`Server on ${PORT}`));
}

export default app;
