const paginate = (query, { page = 1, limit = 20 } = {}) => {
  const skip = (Math.max(1, page) - 1) * limit;
  return query.skip(skip).limit(limit);
};

const paginationMeta = (total, page, limit) => ({
  total,
  page: Number(page),
  limit: Number(limit),
  pages: Math.ceil(total / limit),
});

module.exports = { paginate, paginationMeta };
