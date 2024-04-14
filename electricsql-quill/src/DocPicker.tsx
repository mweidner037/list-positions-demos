import { useLiveQuery } from "electric-sql/react";
import { genUUID } from "electric-sql/util";
import { useState } from "react";

import { useElectric } from "./Loader";
import { Docs as Doc } from "./generated/client";

import logo from "./assets/logo.svg";
import "./DocPicker.css";
import { ElectricQuill } from "./quill/ElectricQuill";

export function DocPicker() {
  const [pickedId, setPickedId] = useState<string>();

  if (pickedId) {
    return <ElectricQuill docId={pickedId} />;
  } else {
    return (
      <NotYetPicked
        onPick={(pickedId) => {
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
        docname: new Date().toISOString(),
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
