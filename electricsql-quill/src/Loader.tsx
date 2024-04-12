import { ReactNode, useEffect, useState } from "react";

import { makeElectricContext } from "electric-sql/react";
import { uniqueTabId } from "electric-sql/util";
import { LIB_VERSION } from "electric-sql/version";
import { ElectricDatabase, electrify } from "electric-sql/wa-sqlite";

import { authToken } from "./auth";
import { Electric, schema } from "./generated/client";

const { ElectricProvider, useElectric } = makeElectricContext<Electric>();

// eslint-disable-next-line react-refresh/only-export-components
export { useElectric };

export const Loader = ({ children }: { children: ReactNode }) => {
  const [electric, setElectric] = useState<Electric>();

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const config = {
        debug: import.meta.env.DEV,
        url: import.meta.env.ELECTRIC_SERVICE,
      };

      const { tabId } = uniqueTabId();
      const scopedDbName = `basic-${LIB_VERSION}-${tabId}.db`;

      const conn = await ElectricDatabase.init(scopedDbName);
      const electric = await electrify(conn, schema, config);
      await electric.connect(authToken());

      // Establish sync with the remote DB using shapes.
      void electric.db.recipes.sync({
        include: {
          ingredients: true,
          bunches: true,
          char_entries: true,
          formatting_marks: true,
        },
      });

      if (!isMounted) {
        return;
      }

      setElectric(electric);
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  const [connected, setConnected] = useState(true);

  if (electric === undefined) {
    return null;
  }

  return (
    <>
      <div>
        {/* Connected checkbox, for testing concurrency. */}
        <input
          type="checkbox"
          id="connected"
          checked={connected}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              electric.connect(authToken());
            } else electric.disconnect();
            setConnected(e.currentTarget.checked);
          }}
        />
        <label htmlFor="connected">Connected</label>
        <hr />
      </div>
      <ElectricProvider db={electric}>{children}</ElectricProvider>
    </>
  );
};
