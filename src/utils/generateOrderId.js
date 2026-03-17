const generateOrderId = async (OrderModel) => {
  const year = new Date().getFullYear();
  const prefix = `CA-${year}-`;

  // Find the latest order for this year to get the highest sequence number
  const latest = await OrderModel.findOne({ orderId: { $regex: `^${prefix}` } })
    .sort({ orderId: -1 })
    .select("orderId")
    .lean();

  let nextSeq = 1001;
  if (latest) {
    const lastSeq = parseInt(latest.orderId.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
};

module.exports = generateOrderId;
