// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L1264
// Modified: literal example parameters; execution/verification handled separately.
db.movies.aggregate([
  // STAGE 1: Data quality filter
  {
    $match: {
      directors: { $exists: true, $ne: null, $not: { $eq: [] } },
      year: { $type: "number" },
    },
  },
  // STAGE 2: Unwind directors array
  {
    $unwind: "$directors",
  },
  // STAGE 3: Clean director names
  {
    $match: {
      directors: { $nin: [null, ""] },
    },
  },
  // STAGE 4: Group by director
  {
    $group: {
      _id: "$directors",
      movieCount: { $sum: 1 },
      averageRating: { $avg: "$imdb.rating" },
    },
  },
  // STAGE 5: Sort by movie count
  {
    $sort: { movieCount: -1 },
  },
  // STAGE 6: Limit results
  {
    $limit: 5,
  },
  // STAGE 7: Shape final output
  {
    $project: {
      director: "$_id",
      movieCount: 1,
      averageRating: { $round: ["$averageRating", 2] },
      _id: 0,
    },
  },
]).toArray();
