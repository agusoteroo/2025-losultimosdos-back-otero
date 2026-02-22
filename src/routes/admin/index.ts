import { Router, Request, Response } from "express";
import checkAdminRole from "../../middleware/admin";
import classRoutes from "./class";
import userRoutes from "./users";
import muscleGroupRoutes from "./muscle-group";
import excersicesRoutes from "./excersices";
import routinesRoutes from "./routines";
import goalsRoutes from "./goals";
import { asyncHandler } from "../../middleware/asyncHandler";
import { validateBody, validateParams } from "../../middleware/validation";
import { sedeCreateSchema } from "../../schemas/sede.schema";
import { BookingStatus, PrismaClient } from "@prisma/client";
import BookingService from "../../services/booking.service";
import { bookingIdParamSchema, bookingStatusSchema } from "../../schemas/booking.schema";

const router = Router();

const prisma = new PrismaClient();

router.use(checkAdminRole);

router.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Admin dashboard" });
});

router.post(
  "/sedes",
  validateBody(sedeCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, address, latitude, longitude } = req.body;
    const sede = await prisma.sede.create({
      data: { name, address, latitude, longitude },
    });
    res.json({ message: "Sede created successfully", sede });
  })
);
router.put(
  "/bookings/:bookingId/status",
  validateParams(bookingIdParamSchema),
  validateBody(bookingStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.bookingId);
    const status = req.body.status as BookingStatus;

    const booking = await BookingService.updateAttendanceStatusByAdmin(
      bookingId,
      status
    );
    res.json({ message: "Booking updated", booking });
  })
);

router.use("/class", classRoutes);
router.use("/users", userRoutes);
router.use("/muscle-group", muscleGroupRoutes);
router.use("/exercises", excersicesRoutes);
router.use("/routines", routinesRoutes);
router.use("/goals", goalsRoutes);

export default router;
