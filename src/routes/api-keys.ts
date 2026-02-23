import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody, validateParams } from "../middleware/validation";
import {
  apiKeyToggleSchema,
  apiKeyIdParamSchema,
} from "../schemas/api-key.schema";
import checkMedibookRole from "../middleware/medibook";
import ApiKeyService from "../services/api-key.service";
import { getAuth } from "@clerk/express";

const router = Router();

router.use(checkMedibookRole);

router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const apiKey = await ApiKeyService.create(userId);

    res.status(201).json(apiKey);
  })
);

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const apiKey = await ApiKeyService.getByUserId(userId);

    if (!apiKey) {
      return res.status(404).json({
        error: "No API key found",
        details: [],
      });
    }

    res.status(200).json(apiKey);
  })
);

router.put(
  "/:keyId/regenerate",
  validateParams(apiKeyIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { keyId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const apiKey = await ApiKeyService.regenerate(keyId, userId);

    res.status(200).json(apiKey);
  })
);

router.put(
  "/:keyId",
  validateParams(apiKeyIdParamSchema),
  validateBody(apiKeyToggleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const apiKey = await ApiKeyService.toggleStatus(keyId, userId, isActive);

    res.status(200).json(apiKey);
  })
);

router.delete(
  "/:keyId",
  validateParams(apiKeyIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    const { keyId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await ApiKeyService.delete(keyId, userId);

    res.status(204).send();
  })
);

export default router;