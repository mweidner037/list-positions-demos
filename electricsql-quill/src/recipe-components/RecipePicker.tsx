import { useLiveQuery } from "electric-sql/react";
import { genUUID } from "electric-sql/util";
import { PositionSource } from "position-strings";
import { useEffect, useState } from "react";

import { useElectric } from "../Loader";
import { Recipes as Recipe } from "../generated/client";
import { DEFAULT_UNIT } from "../units";
import { RecipeEditor } from "./RecipeEditor";

import logo from "../assets/logo.svg";
import "./RecipePicker.css";

export function RecipePicker() {
  const { db } = useElectric()!;

  const [pickedId, setPickedId] = useState<string>();

  // If the URL hash is nonempty, try to use it as the recipe ID.
  // We check it during the first render only.
  const [checkedHash, setCheckedHash] = useState(document.location.hash === "");
  useEffect(() => {
    const hash = document.location.hash.substring(1);
    if (hash !== "") {
      // Check if it is a valid recipe.
      // TODO: The recipe might be valid but not yet synced from Postgres.
      // Should we wait until the shape sync resolves before redirecting?
      db.recipes
        .findUnique({ where: { id: hash } })
        .then((recipe) => {
          if (recipe !== null) setPickedId(recipe.id);
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
    return <RecipeEditor recipeId={pickedId} />;
  } else {
    return (
      <NotYetPicked
        onPick={(pickedId) => {
          // Store pickedId in the URL hash so refreshing still shows the same recipe.
          document.location.hash = pickedId;
          setPickedId(pickedId);
        }}
      />
    );
  }
}

function NotYetPicked({ onPick }: { onPick: (recipeId: string) => void }) {
  const { db } = useElectric()!;

  const { results } = useLiveQuery(
    db.recipes.liveMany({ orderBy: { recipename: "asc" } })
  );

  const addRecipe = async () => {
    const id = genUUID();
    await db.recipes.create({
      data: {
        id,
        recipename: `Untitled ${id.slice(0, 6)}`,
        scale: 1,
      },
    });
    // Add a starting ingredient.
    await db.ingredients.create({
      data: {
        id: genUUID(),
        text: "",
        amount_unscaled: 0,
        units: DEFAULT_UNIT,
        // Arbitrary valid starting position.
        position: new PositionSource({ ID: "INIT" }).createBetween(),
        recipe_id: id,
      },
    });
  };

  const recipes: Recipe[] = results ?? [];

  return (
    <div className="Picker">
      <header className="Picker-header">
        <img src={logo} className="Picker-logo" alt="logo" />
        <div>
          <div className="controls">
            <button className="button" onClick={addRecipe}>
              Add
            </button>
          </div>
          {recipes.map((recipe) => (
            <p
              key={recipe.id}
              className="recipe"
              onClick={() => onPick(recipe.id)}
            >
              <code>{recipe.recipename}</code>
            </p>
          ))}
        </div>
      </header>
    </div>
  );
}
