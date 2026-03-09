const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");
const User = require("../models/User");
const Referral = require("../models/Referral");
const generateReferralCode = require("../utils/generateReferralCode");

const getReferralCode = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  // Generate referral code if user doesn't have one
  if (!user.referralCode) {
    let code;
    let isUnique = false;

    while (!isUnique) {
      code = generateReferralCode();
      const existing = await User.findOne({ referralCode: code });
      if (!existing) isUnique = true;
    }

    user.referralCode = code;
    await user.save();
  }

  // Get referral stats
  const totalReferrals = await Referral.countDocuments({
    referrer: user._id,
  });
  const successfulReferrals = await Referral.countDocuments({
    referrer: user._id,
    isRewarded: true,
  });

  res.status(200).json(
    new ApiResponse(200, {
      referralCode: user.referralCode,
      stats: {
        totalReferrals,
        successfulReferrals,
      },
    })
  );
});

module.exports = { getReferralCode };
