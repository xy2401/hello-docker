// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L216
// Modified: literal example parameters; execution/verification handled separately.
db.movies.insertOne({
  _id: ObjectId('000000000000000000000001'),
  title: 'MFlix insertOne business example',
  year: 2000,
  genres: ['Drama'],
  plot: 'A movie used to practice MongoDB business operations.'
});
