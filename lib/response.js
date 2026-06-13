function sendApiResponse(res, statusCode, message, data = {}) {
  return res.status(statusCode).json({
    data,
    message,
    status: statusCode,
  });
}

export { sendApiResponse };
