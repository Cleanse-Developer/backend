const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const Contact = require("../models/Contact");

const submitContact = asyncHandler(async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  const contact = await Contact.create({
    name,
    email,
    phone,
    subject,
    message,
  });

  res
    .status(201)
    .json(
      new ApiResponse(201, { id: contact._id }, "Message sent successfully. We will get back to you soon.")
    );
});

module.exports = { submitContact };
