import { Ref, useRef, useState } from "react";

import { useElectric } from "../Loader";
import { Ingredients as Ingredient } from "../generated/client";
import { AllUnits, Unit } from "../units";

import "./IngredientEditor.css";

export function IngredientEditor({
  ingr,
  scale,
  textRef,
}: {
  ingr: Ingredient;
  scale: number;
  textRef?: Ref<HTMLInputElement>;
}) {
  const { db } = useElectric()!;

  const [textEditing, setTextEditing] = useState<string | null>(null);
  async function setText(inputStr: string) {
    if (inputStr !== ingr.text) {
      await db.ingredients.update({
        data: { text: inputStr },
        where: { id: ingr.id },
      });
    }
  }

  const amount = ingr.amount_unscaled * scale;

  const [amountEditing, setAmountEditing] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  async function setAmount(inputStr: string) {
    const parsed = Number.parseFloat(inputStr);
    if (!isNaN(parsed) && 0 <= parsed) {
      await db.ingredients.update({
        data: { amount_unscaled: parsed / scale },
        where: { id: ingr.id },
      });
    }
  }

  return (
    <div className="ingredient">
      {/*
         Unlike other demos, we don't use a character-accurate text CRDT for the ingredient
         field, just an LWW field set onBlur (like the amount).
      */}
      <input
        type="text"
        ref={textRef}
        size={12}
        value={textEditing ?? ingr.text}
        onChange={(e) => setTextEditing(e.target.value)}
        onBlur={async () => {
          // Wait until we lose focus to change the value (onBlur).
          if (textEditing === null) return;
          await setText(textEditing);
          setTextEditing(null);
        }}
      />
      <input
        type="number"
        min={0}
        // Although the GUI step is 1, we allow you to type decimals.
        // These are rounded to .00 in the display, although you can enter
        // (or scale) more precise values.
        step={1}
        value={amountEditing ?? Math.round(amount * 100) / 100}
        onChange={async (e) => {
          // If the element is in focus (being typed in), wait until we lose
          // focus to change the value (onBlur).
          // Otherwise (changed using up/down arrows), change the value immediately.
          // TODO: up/down arrows immediately: only works in Firefox, not Chrome.
          if (document.activeElement === amountRef.current) {
            setAmountEditing(e.target.value);
          } else await setAmount(e.target.value);
        }}
        onBlur={async () => {
          if (amountEditing === null) return;
          await setAmount(amountEditing);
          setAmountEditing(null);
        }}
        style={{ width: "5ch" }}
        ref={amountRef}
        // Hide "invalid" tooltip.
        title=""
      />
      <select
        value={ingr.units}
        onChange={async (e) => {
          await db.ingredients.update({
            data: { units: e.target.value as Unit },
            where: { id: ingr.id },
          });
        }}
      >
        {AllUnits.map((unit) => (
          <option value={unit} key={unit}>
            {unit}
          </option>
        ))}
      </select>
    </div>
  );
}
