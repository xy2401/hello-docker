// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L1164
// Modified: literal example parameters; execution/verification handled separately.
db.movies.aggregate([
  // STAGE 1: Data quality filter
  {
    $match: {
      year: { $type: "number" },
    },
  },
  // STAGE 2: Group by year and calculate statistics
  {
    $group: {
      _id: "$year",
      movieCount: { $sum: 1 },
      averageRating: {
        $avg: {
          $cond: [
            {
              $and: [
                { $ne: ["$imdb.rating", null] },
                { $ne: ["$imdb.rating", ""] },
                { $eq: [{ $type: "$imdb.rating" }, "double"] },
              ],
            },
            "$imdb.rating",
            "$$REMOVE",
          ],
        },
      },
      highestRating: {
        $max: {
          $cond: [
            {
              $and: [
                { $ne: ["$imdb.rating", null] },
                { $ne: ["$imdb.rating", ""] },
                { $eq: [{ $type: "$imdb.rating" }, "double"] },
              ],
            },
            "$imdb.rating",
            "$$REMOVE",
          ],
        },
      },
      lowestRating: {
        $min: {
          $cond: [
            {
              $and: [
                { $ne: ["$imdb.rating", null] },
                { $ne: ["$imdb.rating", ""] },
                { $eq: [{ $type: "$imdb.rating" }, "double"] },
              ],
            },
            "$imdb.rating",
            "$$REMOVE",
          ],
        },
      },
      totalVotes: { $sum: "$imdb.votes" },
    },
  },
  // STAGE 3: Shape final output
  {
    $project: {
      year: "$_id",
      movieCount: 1,
      averageRating: { $round: ["$averageRating", 2] },
      highestRating: 1,
      lowestRating: 1,
      totalVotes: 1,
      _id: 0,
    },
  },
  // STAGE 4: Sort by year (newest first)
  {
    $sort: { year: -1 },
  },
]).toArray();
