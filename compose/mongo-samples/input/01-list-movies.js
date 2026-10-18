// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L66
// Modified: literal example parameters; execution/verification handled separately.
db.movies.find({
  genres: { $regex: /Drama/i },
  year: 2000,
  'imdb.rating': { $gte: 7, $lte: 9 }
}).sort({ title: 1 }).limit(5).skip(0).toArray();
