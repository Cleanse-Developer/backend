const mongoose = require("mongoose");

const connectDB = async () => {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI);
      console.log(`MongoDB connected: ${conn.connection.host}`);
      return conn;
    } catch (err) {
      retries++;
      console.error(`MongoDB connection attempt ${retries}/${maxRetries} failed:`, err.message);
      if (retries >= maxRetries) {
        console.error("Max retries reached. Exiting.");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000 * retries));
    }
  }
};

module.exports = connectDB;
