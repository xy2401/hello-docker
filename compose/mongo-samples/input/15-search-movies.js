// MongoDB MFlix, Apache-2.0 (see LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/controllers/movieController.ts#L627
// Modified: literal example parameters; execution/verification handled separately.
db.movies.aggregate([
  {
    $search: {
      index: "movieSearchIndex",
      compound: {
        must: [{
            phrase: {
              query: 'love',
              path: "plot",
            },
          },
          {
            compound: {
              should: [
                // Highest score: exact phrase match
                { phrase: { query: 'Christopher Nolan', path: "directors" } },
                // High score: exact text match (all terms, no fuzzy)
                { text: { query: 'Christopher Nolan', path: "directors", matchCriteria: "all" } },
                // Lower score: fuzzy match (typo tolerance)
                {
                  text: {
                    query: 'Christopher Nolan',
                    path: "directors",
                    matchCriteria: "all",
                    fuzzy: { maxEdits: 1, prefixLength: 2 }, // Allow up to 1 edit, require first 2 characters to match
                  },
                },
              ],
              minimumShouldMatch: 1,
            },
          }],
      },
    },
  },
  {
    $facet: {
      totalCount: [{ $count: "count" }],
      results: [
        { $skip: 0 },
        { $limit: 5 },
        {
          $project: {
            _id: 1,
            title: 1,
            year: 1,
            plot: 1,
            fullplot: 1,
            released: 1,
            runtime: 1,
            poster: 1,
            genres: 1,
            directors: 1,
            writers: 1,
            cast: 1,
            countries: 1,
            languages: 1,
            rated: 1,
            awards: 1,
            imdb: 1,
          },
        },
      ],
    },
  },
]).toArray();
