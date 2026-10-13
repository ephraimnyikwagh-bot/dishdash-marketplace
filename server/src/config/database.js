import mongoose from "mongoose";

export async function checkTransactionSupport(
  connection = mongoose.connection,
  logger = console
) {
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    const supported = Boolean(hello.setName || hello.msg === "isdbgrid");

    if (supported) {
      logger.info("MongoDB transaction support detected.");
    } else {
      logger.warn(
        "MongoDB is connected but does not support transactions. Checkout will not be safe until connected to a replica set or sharded cluster."
      );
    }

    return supported;
  } catch (error) {
    logger.warn(
      `MongoDB is connected, but transaction support could not be verified: ${error.message}`
    );
    return false;
  }
}

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });

  console.info(`Connected to MongoDB database "${mongoose.connection.name}".`);
  await checkTransactionSupport(mongoose.connection);

  return mongoose.connection;
}
