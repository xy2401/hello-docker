// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L828
// Modified: literal example parameters; execution/verification handled separately.
db.movies.aggregate([
  {
    $match: {
      _id: { $in: [ObjectId('573a1390f29313caabcd42e8'), ObjectId('573a1390f29313caabcd446f'), ObjectId('573a1390f29313caabcd4803')] }
    }
  },
  {
    $project: {
      _id: 1,
      title: 1,
      plot: 1,
      poster: 1,
      genres: 1,
      directors: 1,
      cast: 1,
      // Safely convert year to integer, handling strings and dirty data
      year: {
        $cond: {
          if: {
            $and: [
              { $ne: ["$year", null] },
              { $eq: [{ $type: "$year" }, "int"] }
            ]
          },
          then: "$year",
          else: null
        }
      }
    }
  }
]).toArray();
