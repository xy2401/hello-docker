// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L1021
// Modified: literal example parameters; execution/verification handled separately.
db.movies.aggregate([
  { $match: { year: { $type: 'number' }, _id: ObjectId('573a1390f29313caabcd446f') } },
  // STAGE 2: Join with comments collection
  {
    $lookup: {
      from: "comments",
      localField: "_id",
      foreignField: "movie_id",
      as: "comments",
    },
  },
  // STAGE 3: Filter movies with at least one comment
  {
    $match: {
      comments: { $ne: [] },
    },
  },
  // STAGE 4: Add computed fields
  {
    $addFields: {
      recentComments: {
        $slice: [
          {
            $sortArray: {
              input: "$comments",
              sortBy: { date: -1 },
            },
          },
          3,
        ],
      },
      mostRecentCommentDate: {
        $max: "$comments.date",
      },
    },
  },
  // STAGE 5: Sort by most recent comment date
  {
    $sort: { mostRecentCommentDate: -1 },
  },
  // STAGE 6: Limit results
  {
    $limit: 50,
  },
  // STAGE 7: Shape final output
  {
    $project: {
      title: 1,
      year: 1,
      genres: 1,
      _id: 1,
      imdbRating: "$imdb.rating",
      recentComments: {
        $map: {
          input: "$recentComments",
          as: "comment",
          in: {
            _id: "$$comment._id",
            userName: "$$comment.name",
            userEmail: "$$comment.email",
            text: "$$comment.text",
            date: "$$comment.date",
          },
        },
      },
      totalComments: { $size: "$comments" },
    },
  }
]).toArray();
