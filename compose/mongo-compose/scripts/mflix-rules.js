// MFlix business preparation and assertions. No runnable case list lives here.
(() => {
  const fs = require('node:fs');
  const path = require('node:path');
  const movieIds = ['573a1390f29313caabcd42e8', '573a1390f29313caabcd446f', '573a1390f29313caabcd4803'];

  async function prepare(context) {
    const { definition, source, target, check, record, execute } = context;
    const ids = [1, 2, 3].map(value => new ObjectId(value.toString().padStart(24, '0')));
    if (definition.database !== 'temporary') return;
    if (!['empty', 'seed-three', 'created-movie', 'updated-movie', 'text-search', 'text-index'].includes(definition.prepare)) {
      throw new Error('Unknown MFlix preparation rule');
    }
    async function seedThree() {
      const movie = await source.movies.findOne({ year: { $type: 'number' } });
      check(movie !== null, 'Import sample_mflix.movies before preparing write examples');
      const movies = ids.map((id, index) => {
        const copy = EJSON.parse(EJSON.stringify(movie, null, 0, { relaxed: false }));
        copy._id = id;
        copy.title = `MFlix prepared movie ${index + 1}`;
        return copy;
      });
      await target.movies.insertMany(movies);
      check(await target.movies.countDocuments({}) === 3, 'Preparation insert count mismatch');
      record.preparation = 'three copies of a real sample_mflix movie, using fixed practice IDs';
    }

    if (definition.prepare === 'created-movie') {
      await execute('04-insert-one', true);
    } else if (definition.prepare !== 'empty') {
      await seedThree();
      if (definition.prepare === 'updated-movie') await execute('06-update-one', true);
      if (definition.prepare === 'text-search') {
        await target.movies.updateOne({ _id: ids[0] }, { $set: { plot: 'spaceship orbit adventure', fullplot: 'A spaceship travels into orbit.' } });
        await execute('19-text-index', true);
      }
      if (definition.prepare === 'text-index') await execute('19-text-index', true);
    }
  }

  async function verify(context, value) {
    const { definition, source, target, check, record, root } = context;
    const ids = [1, 2, 3].map(value => new ObjectId(value.toString().padStart(24, '0')));
    async function verifyQueryGuards() {
      await load(path.join(root, 'scripts/query-utils.js'));
      const query = globalThis.MflixQuery;
      const escaped = query.escapeRegexLiteral('Drama.*');
      check(new RegExp(escaped).test('Drama.*') && !new RegExp(escaped).test('Dramatic'), 'Literal regex escaping failed');
      const filter = query.convertFilterObjectIds(query.sanitizeBatchFilter({ _id: { $in: [ids[0].toHexString()] }, year: { $gte: 2000 } }));
      check(filter._id.$in[0] instanceof ObjectId, 'Batch ObjectId conversion failed');
      const rejected = [];
      for (const [name, operation] of [
        ['unsupported-filter-field', () => query.sanitizeBatchFilter({ imdb: 1 })],
        ['unsupported-filter-operator', () => query.sanitizeBatchFilter({ year: { $where: 'return true' } })],
        ['unsupported-update-operator', () => query.sanitizeUpdateFields({ $set: { title: 'x' } })],
        ['invalid-object-id', () => query.convertFilterObjectIds({ _id: { $in: ['invalid-id'] } })],
      ]) {
        let refused = false;
        try { operation(); } catch (error) { refused = error.name === 'InvalidMongoQueryError'; }
        check(refused, `Query guard failed: ${name}`);
        rejected.push(name);
      }
      check(query.sanitizeUpdateFields({ title: 'allowed' }).title === 'allowed', 'Allowed update rejected');
      record.queryGuards = { status: 'passed', rejected, mongodbStatement: false };
    }
    async function verifyValue(value) {
      switch (definition.id) {
        case '00-movie-count':
          check(value > 0, 'No sample movies available');
          record.sourceSnapshot = { movies: value, comments: await source.comments.estimatedDocumentCount() };
          check(record.sourceSnapshot.comments > 0, 'No sample comments available');
          await verifyQueryGuards();
          break;
        case '01-list-movies':
          check(value.length > 0 && value.length <= 5, 'Movie page count mismatch');
          check(value.every(movie => Number(movie.year) === 2000 && movie.imdb.rating >= 7 && movie.imdb.rating <= 9 && movie.genres.some(genre => /Drama/i.test(genre))), 'Movie filter mismatch');
          break;
        case '02-distinct-genres':
          check(Array.isArray(value) && value.length > 0 && new Set(value).size === value.length, 'Distinct genres mismatch');
          break;
        case '03-find-movie':
          check(value !== null && value._id.toHexString() === movieIds[0], 'Movie detail mismatch');
          break;
        case '04-insert-one':
          check(value.acknowledged && value.insertedId.equals(ids[0]), 'Insert result mismatch');
          check((await target.movies.findOne({ _id: ids[0] })).title === 'MFlix insertOne business example', 'Inserted movie was not persisted');
          break;
        case '05-insert-many':
          check(value.acknowledged && Object.keys(value.insertedIds).length === 2, 'Batch insert result mismatch');
          check(await target.movies.countDocuments({}) === 2, 'Batch movies were not persisted');
          break;
        case '06-update-one':
          check(value.matchedCount === 1 && value.modifiedCount === 1, 'Update count mismatch');
          const updated = await target.movies.findOne({ _id: ids[0] });
          check(updated.title === 'MFlix updated title' && Number(updated.year) === 2001, 'Updated fields were not persisted');
          break;
        case '07-update-many':
          check(value.matchedCount === 2 && value.modifiedCount === 2, 'Batch update count mismatch');
          check(await target.movies.countDocuments({ title: 'MFlix batch updated title' }) === 2, 'Batch update persistence mismatch');
          check((await target.movies.findOne({ _id: ids[2] })).title === 'MFlix prepared movie 3', 'Unselected movie changed');
          break;
        case '08-delete-one':
          check(value.deletedCount === 1 && await target.movies.countDocuments({}) === 2, 'Delete count mismatch');
          check(await target.movies.findOne({ _id: ids[0] }) === null, 'Deleted movie still exists');
          break;
        case '09-delete-many':
          check(value.deletedCount === 2 && await target.movies.countDocuments({}) === 1, 'Batch delete count mismatch');
          check(await target.movies.findOne({ _id: ids[2] }) !== null, 'Unselected movie was deleted');
          break;
        case '10-find-one-and-delete':
          check(value !== null, 'Atomic delete returned no document');
          check(value._id.equals(ids[0]), 'Atomic delete returned the wrong movie');
          check(await target.movies.findOne({ _id: ids[0] }) === null, 'Atomic delete did not remove the movie');
          break;
        case '11-text-search':
          check(value.length === 1 && value[0]._id.equals(ids[0]), 'Text search did not find the prepared movie');
          break;
        case '12-comments-report':
          check(value.length === 1 && value[0]._id.toHexString() === movieIds[1], 'Comment report movie mismatch');
          check(value[0].totalComments > 0 && value[0].recentComments.length <= 3, 'Recent comment count mismatch');
          check(value[0].recentComments.every((comment, index, list) => index === 0 || list[index - 1].date >= comment.date), 'Comments are not newest first');
          break;
        case '13-year-report':
          check(value.length > 0, 'Year report is empty');
          check(value.reduce((sum, row) => sum + Number(row.movieCount), 0) === await source.movies.countDocuments({ year: { $type: 'number' } }), 'Year totals mismatch');
          check(value.every((row, index) => index === 0 || Number(value[index - 1].year) >= Number(row.year)), 'Year sort mismatch');
          break;
        case '14-director-report':
          check(value.length > 0 && value.length <= 5, 'Director count mismatch');
          check(value.every((row, index) => row.director && (index === 0 || Number(value[index - 1].movieCount) >= Number(row.movieCount))), 'Director ranking mismatch');
          break;
        case '15-search-movies':
          check(Array.isArray(value) && value.length === 1, 'Search facet output mismatch');
          const facet = value[0];
          check(facet.results.length <= 5 && (facet.totalCount[0]?.count || 0) >= facet.results.length, 'Search pagination mismatch');
          break;
        case '16-vector-search':
          check(Array.isArray(value) && value.length <= 5 && value.every(row => row._id && Number.isFinite(row.score)), 'Vector search output mismatch');
          break;
        case '17-vector-hydration':
          check(value.length === movieIds.length && value.every(movie => movieIds.includes(movie._id.toHexString())), 'Hydration IDs mismatch');
          check(value.every(movie => movie.year === null || Number.isInteger(Number(movie.year))), 'Hydration year normalization mismatch');
          break;
        case '18-list-indexes':
          check(Array.isArray(value) && value.some(index => index.key?._fts === 'text'), 'Text index listing mismatch');
          break;
        case '19-text-index':
          check(value === 'text_search_index', 'Created index name mismatch');
          check((await target.movies.getIndexes()).some(index => index.key?._fts === 'text'), 'Created text index was not persisted');
          break;
        case '20-find-created-movie':
          check(value !== null && value._id.equals(ids[0]) && value.title === 'MFlix insertOne business example', 'Created movie readback mismatch');
          break;
        case '21-find-updated-movie':
          check(value !== null && value._id.equals(ids[0]) && value.title === 'MFlix updated title' && Number(value.year) === 2001, 'Updated movie readback mismatch');
          break;
        default:
          throw new Error('Input has no verification rule');
      }
    }

    await verifyValue(value);
  }

  function skipReason(definition) {
    if (definition.requires === 'search' && process.env.MFLIX_ENABLE_SEARCH !== '1') return 'MongoDB Search/movieSearchIndex is not enabled';
    if (definition.requires === 'vector-search' && (process.env.MFLIX_ENABLE_VECTOR_SEARCH !== '1' || !process.env.MFLIX_QUERY_VECTOR_FILE)) {
      return 'Vector Search/vector_index and a real voyage-3-large query embedding are not enabled';
    }
    if (definition.requires && !['search', 'vector-search'].includes(definition.requires)) throw new Error('Unknown MFlix requirement');
    return null;
  }

  function bindParameters({ definition, check, record, hash }) {
    if (definition.requires !== 'vector-search') return;
    const embedding = JSON.parse(fs.readFileSync(process.env.MFLIX_QUERY_VECTOR_FILE, 'utf8'));
    check(definition.parameters?.includes('queryVector'), 'Query vector parameter is not declared');
    check(embedding.model === 'voyage-3-large', 'Query vector model mismatch');
    check(Array.isArray(embedding.embedding) && embedding.embedding.length === 2048 && embedding.embedding.every(Number.isFinite), 'Query vector must contain 2048 finite numeric values');
    globalThis.queryVector = embedding.embedding;
    record.queryVectorSha256 = hash(process.env.MFLIX_QUERY_VECTOR_FILE);
  }

  globalThis.CaseRules = {
    sourceDatabase: 'sample_mflix', prepare, verify, skipReason, bindParameters,
    async createTemporaryDatabase(target) {
      await target.createCollection('movies');
    },
    async snapshot(source) {
      return { movies: await source.movies.estimatedDocumentCount(), comments: await source.comments.estimatedDocumentCount() };
    },
  };
})();
