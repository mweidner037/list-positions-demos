import { useLiveQuery } from "electric-sql/react";
import { genUUID } from "electric-sql/util";
import { useEffect, useState } from "react";

import { useElectric } from "../Loader";
import { Docs as Doc } from "../generated/client";

import logo from "../assets/logo.svg";
import "./DocPicker.css";
import { ElectricQuill } from "../quill/ElectricQuill";

export function DocPicker() {
  const { db } = useElectric()!;

  const [pickedId, setPickedId] = useState<string>();

  // If the URL hash is nonempty, try to use it as the doc ID.
  // We check it during the first render only.
  const [checkedHash, setCheckedHash] = useState(document.location.hash === "");
  useEffect(() => {
    const hash = document.location.hash.substring(1);
    if (hash !== "") {
      // Check if it is a valid doc.
      // TODO: The doc might be valid but not yet synced from Postgres.
      // Should we wait until the shape sync resolves before redirecting?
      db.docs
        .findUnique({ where: { id: hash } })
        .then((doc) => {
          if (doc !== null) setPickedId(doc.id);
          else document.location.hash = "";
          setCheckedHash(true);
        })
        .catch(() => {
          // Assume the hash is not a valid ID.
          document.location.hash = "";
          setCheckedHash(true);
        });
    }
  }, []);

  // If we're still checking the hash, don't show NotYetPicked, to prevent it
  // from flashing briefly.
  if (!checkedHash) {
    return null;
  }

  if (pickedId) {
    return <ElectricQuill docId={pickedId} />;
  } else {
    return (
      <NotYetPicked
        onPick={(pickedId) => {
          // Store pickedId in the URL hash so refreshing still shows the same doc.
          document.location.hash = pickedId;
          setPickedId(pickedId);
        }}
      />
    );
  }
}

function NotYetPicked({ onPick }: { onPick: (docId: string) => void }) {
  const { db } = useElectric()!;

  const { results } = useLiveQuery(
    db.docs.liveMany({ orderBy: { docname: "asc" } })
  );

  const addDoc = async () => {
    const id = genUUID();
    await db.docs.create({
      data: {
        id,
        docname: `Untitled ${id.slice(0, 6)}`,
      },
    });
  };

  const docs: Doc[] = results ?? [];

  return (
    <div className="Picker">
      <header className="Picker-header">
        <img src={logo} className="Picker-logo" alt="logo" />
        <div>
          <div className="controls">
            <button className="button" onClick={addDoc}>
              Add
            </button>
          </div>
          {docs.map((doc) => (
            <p key={doc.id} className="docP" onClick={() => onPick(doc.id)}>
              <code>{doc.docname}</code>
            </p>
          ))}
        </div>
      </header>
    </div>
  );
}
