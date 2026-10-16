import jwt from "jsonwebtoken";

const roles = ["buyer", "vendor", "courier", "admin"];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be configured with at least 32 characters"
    );
  }
  return secret;
}

export function requireAuth(request, response, next) {
  const authorization = request.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    response.status(401).json({ message: "Authentication required" });
    return;
  }

  const secret = getJwtSecret();
  try {
    const payload = jwt.verify(match[1], secret, {
      issuer: "carted-api",
      audience: "carted"
    });

    if (
      typeof payload === "string" ||
      !payload.sub ||
      !roles.includes(payload.role)
    ) {
      response.status(401).json({ message: "Invalid authentication token" });
      return;
    }

    request.auth = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      response.status(401).json({ message: "Invalid or expired token" });
      return;
    }
    next(error);
  }
}

export function allowRoles(...allowedRoles) {
  const permitted = new Set(allowedRoles);

  return (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    if (!permitted.has(request.auth.role)) {
      response.status(403).json({ message: "Insufficient permissions" });
      return;
    }

    next();
  };
}
