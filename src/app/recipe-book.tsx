"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { recipes, unlockedRecipeTier, vocabularyById } from "@/data/content";
import type { PlayerState, Recipe } from "@/types/game";

const TIER_NAMES: Record<Recipe["unlockTier"], string> = {
  1: "Campus basics",
  2: "Student life",
  3: "Big ideas",
};

type RecipeBookProps = {
  player: PlayerState;
  onTryFormula: (ingredients: Recipe["ingredients"]) => void;
  onVisitBuilding: (buildingName: string) => void;
};

function handStatus(recipe: Recipe, hand: readonly string[]) {
  const owned = recipe.ingredients.filter((ingredient) => hand.includes(ingredient));
  const missing = recipe.ingredients.filter((ingredient) => !hand.includes(ingredient));
  return { owned, missing, ready: missing.length === 0 };
}

function sortRecipesForPlayer(items: Recipe[], player: PlayerState) {
  const discovered = new Set(player.discoveredRecipes);
  return [...items].sort((left, right) => {
    const rank = (recipe: Recipe) => {
      if (discovered.has(recipe.id)) return 3;
      return handStatus(recipe, player.hand).missing.length;
    };
    return rank(left) - rank(right);
  });
}

export function RecipeBook({ player, onTryFormula, onVisitBuilding }: RecipeBookProps) {
  const discovered = useMemo(() => new Set(player.discoveredRecipes), [player.discoveredRecipes]);
  const unlockedTier = unlockedRecipeTier(player.discoveredRecipes);
  const knownDiscoveries = useRef(new Set(player.discoveredRecipes));
  const [freshDiscovery, setFreshDiscovery] = useState<string | null>(null);
  const currentTierRecipes = recipes.filter((recipe) => recipe.unlockTier === unlockedTier);
  const currentTierBuilt = currentTierRecipes.filter((recipe) => discovered.has(recipe.id)).length;
  const readyBlueprint = recipes.find((recipe) => recipe.unlockTier <= unlockedTier && !discovered.has(recipe.id) && handStatus(recipe, player.hand).ready);
  const campusComplete = player.discoveredRecipes.length === recipes.length;

  useEffect(() => {
    const newDiscovery = player.discoveredRecipes.find((id) => !knownDiscoveries.current.has(id));
    knownDiscoveries.current = new Set(player.discoveredRecipes);
    if (!newDiscovery) return;
    setFreshDiscovery(newDiscovery);
    const timer = window.setTimeout(() => setFreshDiscovery(null), 1800);
    return () => window.clearTimeout(timer);
  }, [player.discoveredRecipes]);

  const missionTitle = campusComplete ? "Your campus is complete" : readyBlueprint ? "A blueprint is ready" : currentTierBuilt === currentTierRecipes.length ? "A new district is opening" : "Hunt for a matching pair";
  const missionCopy = campusComplete
    ? "You uncovered every mystery building. Revisit a favorite place or keep building to level it up."
    : readyBlueprint
    ? `You have both words for ${readyBlueprint.ingredients.map((id) => vocabularyById[id]?.word || id).join(" + ")}. Start the build when you are ready.`
    : currentTierBuilt === currentTierRecipes.length
      ? "You cleared this district. New blueprints are now on the map."
      : "Watch your word shelf. When both ingredients arrive, use them together in one meaningful sentence.";

  return (
    <section className="panel campus-panel recipe-panel" aria-labelledby="recipe-book-title">
      <header className="recipe-book-head">
        <div>
          <div className="eyebrow">Campus discovery log</div>
          <h3 id="recipe-book-title">Build the mystery campus</h3>
          <p className="subtle">Words are your materials. Pair them in a sentence, then watch the blueprint become a real place.</p>
        </div>
        <div className="formula-total" aria-label={`${player.discoveredRecipes.length} of ${recipes.length} places discovered`}>
          <strong>{player.discoveredRecipes.length}</strong>
          <span>of {recipes.length}</span>
          <small>places found</small>
        </div>
      </header>

      <div className="formula-route" aria-hidden="true">
        {recipes.map((recipe, index) => (
          <span className={index < player.discoveredRecipes.length ? "found" : index === player.discoveredRecipes.length ? "next" : ""} key={recipe.id}>
            {index < player.discoveredRecipes.length ? "✓" : index + 1}
          </span>
        ))}
      </div>

      <div className={`formula-mission ${readyBlueprint ? "ready" : ""}`} role="status">
        <span className="mission-compass" aria-hidden="true">✦</span>
        <div>
          <small>Right now · Tier {unlockedTier}</small>
          <strong>{missionTitle}</strong>
          <p>{missionCopy}</p>
        </div>
        <span className="mission-count">{currentTierBuilt}/{currentTierRecipes.length}</span>
      </div>

      {freshDiscovery && (
        <div className="formula-reveal-banner" role="status">
          <span aria-hidden="true">✦</span>
          Blueprint revealed: {recipes.find((recipe) => recipe.id === freshDiscovery)?.result}
        </div>
      )}

      <div className="formula-tiers">
        {([1, 2, 3] as const).map((tier) => {
          const tierRecipes = recipes.filter((recipe) => recipe.unlockTier === tier);
          const builtCount = tierRecipes.filter((recipe) => discovered.has(recipe.id)).length;
          const tierOpen = tier <= unlockedTier;
          const tierPreview = !tierOpen && tier === unlockedTier + 1;
          const discoveredAhead = tierRecipes.filter((recipe) => discovered.has(recipe.id));
          const visibleRecipes = tierOpen ? sortRecipesForPlayer(tierRecipes, player) : discoveredAhead;

          return (
            <section className={`formula-tier ${tierOpen ? "open" : tierPreview ? "preview" : "sealed"}`} key={tier} aria-labelledby={`formula-tier-${tier}`}>
              <header className="formula-tier-head">
                <div className="tier-number" aria-hidden="true">{String(tier).padStart(2, "0")}</div>
                <div>
                  <small>{tierOpen ? (tier === unlockedTier ? "Current district" : "District cleared") : tierPreview ? "Next district" : "Map hidden"}</small>
                  <h4 id={`formula-tier-${tier}`}>{TIER_NAMES[tier]}</h4>
                </div>
                <span>{builtCount}/{tierRecipes.length} found</span>
              </header>

              {visibleRecipes.length > 0 && (
                <div className="tier-formulas">
                  {visibleRecipes.map((recipe) => {
                    const isDiscovered = discovered.has(recipe.id);
                    const status = handStatus(recipe, player.hand);
                    const waitingFor = status.missing.map((id) => vocabularyById[id]?.word || id);
                    const stateLabel = isDiscovered ? "Discovered" : status.ready ? "2/2 · Ready now" : `${status.owned.length}/2 · ${status.owned.length === 1 ? "One word ready" : "Keep exploring"}`;

                    return (
                      <article className={`formula-card ${isDiscovered ? "discovered" : "blueprint"} ${status.ready ? "ready" : ""} ${freshDiscovery === recipe.id ? "fresh" : ""}`} key={recipe.id}>
                        <div className="formula-card-top">
                          <div className="formula-art-shell">
                            <Image className="formula-art" src={recipe.buildingImage} alt={isDiscovered ? `${recipe.result} illustration` : ""} width={96} height={96} aria-hidden={!isDiscovered} />
                            {!isDiscovered && <span className="formula-question" aria-hidden="true">?</span>}
                          </div>
                          <div className="formula-card-copy">
                            <span className="formula-state">{stateLabel}</span>
                            <h5>{isDiscovered ? recipe.result : "Mystery building"}</h5>
                            <p>{isDiscovered ? recipe.discoveryText : "Use both words in one meaningful sentence to reveal this place."}</p>
                          </div>
                        </div>

                        <div className="formula-equation" aria-label={`Formula: ${recipe.ingredients.map((id) => vocabularyById[id]?.word || id).join(" plus ")}`}>
                          {recipe.ingredients.map((ingredient, index) => {
                            const inHand = player.hand.includes(ingredient);
                            return (
                              <Fragment key={ingredient}>
                                {index > 0 && <span className="formula-plus" aria-hidden="true">+</span>}
                                <span className={inHand ? "in-hand" : ""}>
                                  <b>{vocabularyById[ingredient]?.word || ingredient}</b>
                                  <em>{inHand ? "✓ in hand" : "not in hand"}</em>
                                </span>
                              </Fragment>
                            );
                          })}
                        </div>

                        <footer className="formula-card-footer">
                          {status.ready ? (
                            <button type="button" className="formula-action" onClick={() => onTryFormula(recipe.ingredients)}>
                              {isDiscovered ? "Build again" : "Start this build"}<span aria-hidden="true">↗</span>
                            </button>
                          ) : (
                            <span className="formula-waiting">{waitingFor.length === 1 ? `Find “${waitingFor[0]}”` : "Find both word cards"}</span>
                          )}
                          {isDiscovered && (
                            <button type="button" className="formula-visit" onClick={() => onVisitBuilding(recipe.result)}>Visit building</button>
                          )}
                        </footer>
                        {isDiscovered && <span className="discovery-stamp" aria-hidden="true">FOUND</span>}
                      </article>
                    );
                  })}
                </div>
              )}

              {!tierOpen && tierPreview && discoveredAhead.length === 0 && (
                <div className="district-teaser">
                  <div className="teaser-silhouette" aria-hidden="true">
                    <Image src={tierRecipes[0].buildingImage} alt="" width={104} height={104} />
                    <span>?</span>
                  </div>
                  <div>
                    <strong>A new part of campus is under the paper</strong>
                    <p>Finish Tier {unlockedTier} to uncover {tierRecipes.length} new blueprints.</p>
                  </div>
                  <span className="teaser-lock">{currentTierBuilt}/{currentTierRecipes.length}</span>
                </div>
              )}

              {!tierOpen && !tierPreview && discoveredAhead.length === 0 && (
                <div className="district-seal">
                  <span aria-hidden="true">{String(tier).padStart(2, "0")}</span>
                  <p><strong>This district is still off the map.</strong> Clear the earlier campus districts to reveal its first clue.</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
