import { Schema as S } from "@triplit/db";

/**
 * Define your schema here. To use your schema, you can either:
 * - Directly import your schema into your app
 * - Run 'triplit migrate create' to generate migrations (recommended for production apps)
 *
 * For more information on schemas, see the docs: https://www.triplit.dev/docs/schemas
 */
export const schema = {
  bunches: {
    schema: S.Schema({
      // The bunchID.
      id: S.Id(),
      parentID: S.String(),
      offset: S.Number(),
    }),
  },
  values: {
    schema: S.Schema({
      // Unused.
      id: S.Id(),
      // Foreign key @ bunches table.
      bunchID: S.String(),
      innerIndex: S.Number(),
      value: S.String(),
    }),
  },
  marks: {
    schema: S.Schema({
      // Unused.
      id: S.Id(),
      // TODO: use nested records for anchors?
      // Foreign key @ bunches table.
      startBunchID: S.String(),
      startInnerIndex: S.Number(),
      startBefore: S.Boolean(),
      // Foreign key @ bunches table.
      endBunchID: S.String(),
      endInnerIndex: S.Number(),
      endBefore: S.Boolean(),
      key: S.String(),
      // JSON-ified any.
      value: S.String(),
      creatorID: S.String(),
      timestamp: S.Number(),
    }),
  },
};
