/**
 * Append an attributed entry to an order's unified activity log
 * (order.adminNotes). Used by every participant — customer, system, courier,
 * admin — so the Activity feed shows who did what.
 *
 * @param {object} order   Mongoose Order document (mutated, not saved here)
 * @param {object} opts
 * @param {"customer"|"system"|"courier"|"admin"} opts.actor
 * @param {string} opts.note      Human-readable text
 * @param {string} [opts.event]   Machine event key (e.g. "status:shipped")
 * @param {boolean} [opts.isOverride]  Admin manually did an otherwise-auto step
 * @param {ObjectId} [opts.by]    User id (admin/customer) when applicable
 */
const logActivity = (order, { actor, note, event, isOverride = false, by } = {}) => {
  if (!order) return;
  order.adminNotes = order.adminNotes || [];
  order.adminNotes.push({
    actor: actor || "admin",
    note,
    event,
    isOverride,
    addedBy: by,
    addedAt: new Date(),
  });
};

const ACTORS = { CUSTOMER: "customer", SYSTEM: "system", COURIER: "courier", ADMIN: "admin" };

module.exports = { logActivity, ACTORS };
