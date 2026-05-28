const Agenda = require("agenda");

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: "agendaJobs",
  },
  processEvery: "30 seconds",
  maxConcurrency: 5,
  defaultConcurrency: 1,
});

module.exports = agenda;
