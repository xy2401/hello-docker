// Derived from MongoDB Documentation Team, Apache-2.0 (see ../input/LICENSE).
// Source: https://github.com/mongodb/sample-app-nodejs-mflix/blob/1f7dcdba04f6212a5fd4842135973e28a0a2d741/server/src/utils/mongoQuery.ts
// Modified: TypeScript types/imports/exports removed; exposed for mongosh scripts.
(() => {
const MOVIE_FIELDS = [
  "title",
  "year",
  "plot",
  "fullplot",
  "genres",
  "directors",
  "writers",
  "cast",
  "countries",
  "languages",
  "rated",
  "runtime",
  "poster",
];
const ALLOWED_FILTER_FIELDS = new Set([...MOVIE_FIELDS, "_id"]);
const ALLOWED_OPERATORS = new Set([
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$ne",
  "$exists",
]);
const UPDATE_FIELDS = [...MOVIE_FIELDS];
const UNSUPPORTED_FILTER_MESSAGE = "Filter contains an unsupported field or operator";
const UNSUPPORTED_UPDATE_MESSAGE = "Update contains an unsupported field or operator";
function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
class InvalidMongoQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidMongoQueryError";
  }
}
function sanitizeOperatorValue(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const operatorMap = value;
  const sanitized = {};
  for (const [operator, operatorValue] of Object.entries(operatorMap)) {
    if (!operator.startsWith("$") || !ALLOWED_OPERATORS.has(operator)) {
      throw new InvalidMongoQueryError(UNSUPPORTED_FILTER_MESSAGE);
    }
    sanitized[operator] = operatorValue;
  }
  return sanitized;
}
function sanitizeBatchFilter(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new InvalidMongoQueryError("Filter must be a non-array object");
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("$") || !ALLOWED_FILTER_FIELDS.has(key)) {
      throw new InvalidMongoQueryError(UNSUPPORTED_FILTER_MESSAGE);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeOperatorValue(value);
    }
    else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
function sanitizeUpdateFields(update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new InvalidMongoQueryError("Update must be a non-array object");
  }
  const sanitized = {};
  for (const key of Object.keys(update)) {
    if (key.startsWith("$") ||
      !UPDATE_FIELDS.includes(key)) {
      throw new InvalidMongoQueryError(UNSUPPORTED_UPDATE_MESSAGE);
    }
    sanitized[key] = update[key];
  }
  return sanitized;
}
function convertFilterObjectIds(filter) {
  const processedFilter = { ...filter };
  if (processedFilter._id &&
    typeof processedFilter._id === "object" &&
    processedFilter._id !== null &&
    "$in" in processedFilter._id &&
    Array.isArray(processedFilter._id.$in)) {
    processedFilter._id = {
      $in: processedFilter._id.$in.map((id) => {
        const idStr = String(id);
        if (ObjectId.isValid(idStr)) {
          return new ObjectId(idStr);
        }
        throw new InvalidMongoQueryError(UNSUPPORTED_FILTER_MESSAGE);
      }),
    };
  }
  return processedFilter;
}
globalThis.MflixQuery = { escapeRegexLiteral, sanitizeBatchFilter, sanitizeUpdateFields, convertFilterObjectIds, InvalidMongoQueryError };
})();
