import { Router, Request, Response } from "express";
import { User } from "@clerk/express";
import { asyncHandler } from "../../middleware/asyncHandler";
import UserService from "../../services/user.service";
import { ApiValidationError } from "../../services/api-validation-error";
import ClassService from "../../services/class.service";
import BookingService from "../../services/booking.service";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const sedeId = Number(_req.query.sedeId);

      let users: User[] = [];
      if (sedeId) {
        users = await UserService.getUsersBySedeId(sedeId);
      } else {
        const usersResponse = await UserService.getUsers();
        users = usersResponse.data;
      }
      const sanitizedUsers = users.map((user: User) =>
        UserService.sanitizeUser(user)
      );
      res.json({
        message: "Users retrieved successfully",
        users: sanitizedUsers,
      });
    } catch (error) {
      throw new ApiValidationError("Failed to fetch users from Clerk", 500);
    }
  })
);

router.get(
  "/:userId",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const user = await UserService.getUserById(userId);
      res.json({
        message: "User retrieved successfully",
        user,
      });
    } catch (error) {
      throw new ApiValidationError("Failed to fetch user from Clerk", 404);
    }
  })
);

router.put(
  "/:userId/role",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { role } = req.body;
    const user = await UserService.updateUserRole(userId, role);
    res.json({
      message: "User role updated successfully",
      user,
    });
  })
);

router.get(
  "/:userId/classes",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const sedeIdParam = req.query.sedeId;
      const sedeId = sedeIdParam ? Number(sedeIdParam) : undefined;

      if (sedeIdParam && Number.isNaN(sedeId)) {
        throw new ApiValidationError("Invalid sedeId", 400);
      }

      const classes = await ClassService.getActiveClassesByUserId(userId, sedeId);
      res.json({
        message: "User classes retrieved successfully",
        classes,
      });
    } catch (error) {
      if (error instanceof ApiValidationError) throw error;
      throw new ApiValidationError("Failed to fetch user classes", 500);
    }
  })
);

router.get(
  "/:userId/bookings",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const sedeIdParam = req.query.sedeId;
      const sedeId = sedeIdParam ? Number(sedeIdParam) : undefined;

      if (sedeIdParam && Number.isNaN(sedeId)) {
        throw new ApiValidationError("Invalid sedeId", 400);
      }

      const bookings = await BookingService.getUserBookings(userId, sedeId);
      res.json({
        message: "User bookings retrieved successfully",
        bookings,
      });
    } catch (error) {
      if (error instanceof ApiValidationError) throw error;
      throw new ApiValidationError("Failed to fetch user bookings", 500);
    }
  })
);

router.put(
  "/:userId/plan",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { plan } = req.body;
    const user = await UserService.updateUserPlan(userId, plan);
    res.json({
      message: "User plan updated successfully",
      user: UserService.sanitizeUser(user),
    });
  })
);

router.put(
  "/:userId/sede",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { sedeId } = req.body;
    const user = await UserService.updateUserSede(userId, sedeId);
    res.json({
      message: "User sede updated successfully",
      user: UserService.sanitizeUser(user),
    });
  })
);

export default router;
