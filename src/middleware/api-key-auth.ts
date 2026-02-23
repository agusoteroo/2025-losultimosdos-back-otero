import { Request, Response, NextFunction } from "express";
import ApiKeyService from "../services/api-key.service";

const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "Invalid API key",
        details: [],
      });
    }

    const apiKey = authHeader.replace("Bearer ", "");

    if (!apiKey || !apiKey.startsWith("mk_live_")) {
      return res.status(401).json({
        error: "Invalid API key",
        details: [],
      });
    }

    const keyRecord = await ApiKeyService.validateKey(apiKey);

    if (!keyRecord) {
      return res.status(401).json({
        error: "Invalid or inactive API key",
        details: [],
      });
    }

    (req as any).apiKeyUser = {
      id: keyRecord.userId,
      role: "medibook",
    };

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error validating API key:", { message });
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default validateApiKey;
