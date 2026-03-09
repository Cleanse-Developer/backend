const generateOrderId = async (OrderModel) => {
  const year = new Date().getFullYear();
  const count = await OrderModel.countDocuments();
  return `CA-${year}-${String(count + 1001).padStart(4, "0")}`;
};

module.exports = generateOrderId;
