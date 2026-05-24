package com.pucky.device.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class PuckyRecipeControllerTest {
    @Test
    public void migrationImportsLegacyBundleWhenNewStoreIsEmpty() {
        PuckyRecipeController.MigrationPlan plan = PuckyRecipeController.planMigration(
                "",
                "{\"schema\":\"pucky.recipe_bundle.v1\"}",
                true,
                "2026-05-24T12:00:00Z");

        assertTrue(plan.importLegacyBundle);
        assertTrue(plan.clearLegacy);
        assertEquals("{\"schema\":\"pucky.recipe_bundle.v1\"}", plan.bundleToKeep);
        assertEquals("2026-05-24T12:00:00Z", plan.migratedAt);
    }

    @Test
    public void migrationKeepsCurrentBundleWhenAlreadyPresent() {
        PuckyRecipeController.MigrationPlan plan = PuckyRecipeController.planMigration(
                "{\"schema\":\"current\"}",
                "{\"schema\":\"legacy\"}",
                true,
                "2026-05-24T12:00:00Z");

        assertFalse(plan.importLegacyBundle);
        assertTrue(plan.clearLegacy);
        assertEquals("{\"schema\":\"current\"}", plan.bundleToKeep);
    }

    @Test
    public void migrationSkipsLegacyCleanupWhenThereIsNoLegacyState() {
        PuckyRecipeController.MigrationPlan plan = PuckyRecipeController.planMigration(
                "",
                "",
                false,
                "2026-05-24T12:00:00Z");

        assertFalse(plan.importLegacyBundle);
        assertFalse(plan.clearLegacy);
        assertEquals("", plan.bundleToKeep);
    }
}
