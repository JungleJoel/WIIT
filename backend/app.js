const express = require("express");
const eadRoutes = require("./modules/ead/ead.routes");

const app = express();

app.use(express.json());
app.use("/api/ead", eadRoutes);

// Handle upload errors and other Express errors.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || (error instanceof URIError ? 400 : 500);

  res.status(status).json({
    message: status === 500 ? "Internal server error." : error.message,
  });
});

module.exports = app;