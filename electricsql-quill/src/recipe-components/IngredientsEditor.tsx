import { useEffect, useRef, useState } from "react";

import { useLiveQuery } from "electric-sql/react";
import { PositionSource } from "position-strings";
import { useElectric } from "../Loader";
import {
  Ingredients as Ingredient,
  Recipes as Recipe,
} from "../generated/client";
import { IngredientEditor } from "./IngredientEditor";

import { genUUID } from "electric-sql/util";
import { DEFAULT_UNIT } from "../units";
import "./IngredientsEditor.css";

// Okay if this is shared globally, although in practice there is
// just one Ingredients component.
const positionSource = new PositionSource();

export function IngredientsEditor({ recipe }: { recipe: Recipe }) {
  const { db } = useElectric()!;

  const { results } = useLiveQuery(
    db.ingredients.liveMany({
      where: { recipe_id: recipe.id },
      orderBy: { position: "asc" },
    })
  );
  const ingredients: Ingredient[] = results ?? [];

  // When the local user adds a new ingredient, scroll to it and
  // select its text.
  const [newIngrId, setNewIngrId] = useState<string | null>(null);
  const newIngrTextRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (newIngrTextRef.current === null) return;
    newIngrTextRef.current.select();
    newIngrTextRef.current.scrollIntoView();
    // Use newIngr as dependency so this only runs on the first render after adding.
  }, [newIngrId]);

  // TODO: scroll-to-ingredient if the one you're editing is moved.
  return (
    <>
      <div className="title">Ingredients</div>
      {ingredients.map((ingr, index) => (
        <div key={ingr.id} className="ingredientWrapper">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              style={{ alignSelf: "flex-start" }}
              disabled={index === 0}
              onClick={async () => {
                // Create a position between index-2 and index-1.
                const newPos = positionSource.createBetween(
                  index === 1 ? undefined : ingredients[index - 2].position,
                  ingredients[index - 1].position
                );
                await db.ingredients.update({
                  data: {
                    position: newPos,
                  },
                  where: {
                    id: ingr.id,
                  },
                });
              }}
            >
              ↑
            </button>
            <button
              style={{ alignSelf: "flex-start" }}
              disabled={index === ingredients.length - 1}
              onClick={async () => {
                // Create a position between index+1 and index+2.
                const newPos = positionSource.createBetween(
                  ingredients[index + 1].position,
                  index === ingredients.length - 2
                    ? undefined
                    : ingredients[index + 2].position
                );
                await db.ingredients.update({
                  data: {
                    position: newPos,
                  },
                  where: {
                    id: ingr.id,
                  },
                });
              }}
            >
              ↓
            </button>
          </div>
          <IngredientEditor
            ingr={ingr}
            scale={recipe.scale}
            textRef={ingr.id === newIngrId ? newIngrTextRef : undefined}
          />
          <button
            onClick={async () => {
              // My understanding is that this will be a logical delete that is canceled
              // by concurrent edits to the ingredient (as we want), though I am
              // not sure - see dev_notes.md points 2 & 3.
              await db.ingredients.delete({ where: { id: ingr.id } });
            }}
            className="deleteButton"
          >
            X
          </button>
        </div>
      ))}
      <button
        onClick={async () => {
          const ingr: Ingredient = {
            id: genUUID(),
            position: positionSource.createBetween(
              ingredients.at(-1)?.position
            ),
            text: "",
            amount_unscaled: 0,
            units: DEFAULT_UNIT,
            recipe_id: recipe.id,
          };
          await db.ingredients.create({ data: ingr });
          // Scroll into view.
          setNewIngrId(ingr.id);
        }}
        className="addButton"
      >
        +
      </button>
      <br />
      <button
        onClick={async () => {
          await db.recipes.update({
            data: { scale: recipe.scale * 2.0 },
            where: { id: recipe.id },
          });
        }}
        className="scaleButton"
      >
        Double the recipe!
      </button>
      &nbsp;&nbsp;
      <button
        onClick={async () => {
          await db.recipes.update({
            data: { scale: recipe.scale * 0.5 },
            where: { id: recipe.id },
          });
        }}
        className="scaleButton"
      >
        Halve the recipe!
      </button>
    </>
  );
}
