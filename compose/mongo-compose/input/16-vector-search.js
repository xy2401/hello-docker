// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L828
// Modified: literal example parameters; execution/verification handled separately.
db.embedded_movies.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "plot_embedding_voyage_3_large",
      queryVector: queryVector,
      numCandidates: 5 * 20, // We recommend searching 20 times higher than the limit to improve result relevance
      limit: 5,
    },
  },
  {
    $project: {
      _id: 1,
      score: { $meta: "vectorSearchScore" },
    },
  },
]).toArray();
