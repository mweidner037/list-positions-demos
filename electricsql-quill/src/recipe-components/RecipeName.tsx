import { useState } from "react";

import "./RecipeName.css";

const maxNameLength = 25;

export function RecipeName({
  recipeName,
  onSet,
}: {
  recipeName: string;
  onSet: (newRecipeName: string) => void;
}) {
  const [nameEditing, setNameEditing] = useState<string | null>(null);
  const nameValue = nameEditing ?? recipeName;

  return (
    <div className="recipe-name-wrapper">
      <input
        type="text"
        maxLength={maxNameLength}
        className="recipe-name"
        style={{ width: "100%" }}
        value={nameValue}
        size={1}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setNameEditing(e.target.value)}
        onBlur={() => {
          if (nameEditing === null) return;
          let parsed = nameEditing.slice(0, maxNameLength).trim();
          if (parsed === "") parsed = "Untitled";
          // Don't perform an op for an aborted edit.
          if (parsed !== recipeName) onSet(parsed);
          setNameEditing(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {/* Invisible div to force the parent's (hence input's) size to match valueName. */}
      <div className="recipe-name hidden">{nameValue}</div>
    </div>
  );
}
