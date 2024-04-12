import { useLiveQuery } from "electric-sql/react";
import { useElectric } from "../Loader";
import { IngredientsEditor } from "./IngredientsEditor";
import { RecipeName } from "./RecipeName";

import { ElectricQuill } from "../quill/ElectricQuill";
import "./RecipeEditor.css";

export function RecipeEditor({ recipeId }: { recipeId: string }) {
  const { db } = useElectric()!;

  const { results: recipe } = useLiveQuery(
    db.recipes.liveUnique({ where: { id: recipeId } })
  );

  if (!recipe) {
    return <>Loading...</>;
  }

  return (
    <div className="outerDiv">
      <RecipeName
        recipeName={recipe.recipename}
        onSet={async (newRecipeName) => {
          await db.recipes.update({
            where: { id: recipeId },
            data: { recipename: newRecipeName },
          });
        }}
      />
      <div className="splitViewport">
        <div className="split left">
          <div className="centered">
            <IngredientsEditor recipe={recipe} />
          </div>
        </div>
        {
          <div className="split right">
            <div className="instructions">
              <div className="title">Instructions</div>
              <ElectricQuill docId={recipeId} />
            </div>
          </div>
        }
      </div>
    </div>
  );
}
