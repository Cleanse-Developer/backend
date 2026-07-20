const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const Contact = require("../models/Contact");
const { sendContactNotification } = require("../services/email.service");

// Same success payload for real submissions and silently-dropped spam, so bots
// can't tell which requests were rejected.
const ACCEPTED = (id) =>
  new ApiResponse(201, { id }, "Message sent successfully. We will get back to you soon.");

const submitContact = asyncHandler(async (req, res) => {
  const { name, email, phone, subject, message, website } = req.body;

  // Honeypot: `website` is a hidden field no human sees. Anything in it is a
  // bot — accept the request but drop it.
  if (website) {
    return res.status(201).json(ACCEPTED(null));
  }

  // Duplicate guard: same person re-posting the identical message within 10
  // minutes (double-click, retry loop, or a crude spammer) — don't store twice.
  const recent = await Contact.findOne({
    email: String(email).toLowerCase().trim(),
    message,
    createdAt: { $gt: new Date(Date.now() - 10 * 60 * 1000) },
  })
    .select("_id")
    .lean();
  if (recent) {
    return res.status(201).json(ACCEPTED(recent._id));
  }

  const contact = await Contact.create({
    name,
    email,
    phone,
    subject,
    message,
  });

  // Notify the team by email. Best-effort: a mail failure must not fail the
  // submission — it's already saved and viewable in the admin.
  sendContactNotification({ name, email, phone, subject, message }).catch((err) =>
    console.error("[contact] notification email failed:", err.message)
  );

  res
    .status(201)
    .json(
      new ApiResponse(201, { id: contact._id }, "Message sent successfully. We will get back to you soon.")
    );
});

module.exports = { submitContact };
