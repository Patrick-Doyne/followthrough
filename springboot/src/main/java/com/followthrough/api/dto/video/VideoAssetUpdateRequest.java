package com.followthrough.api.dto.video;

import jakarta.validation.constraints.NotBlank;

/** Only the human-editable fields -- everything else on a VideoAsset
 * (status, storageKey, analyzedShots, shootingPercentage, sizeMb,
 * durationSeconds) is pipeline-computed, not something a rename dialog
 * should be able to touch. */
public record VideoAssetUpdateRequest(@NotBlank String title, String thumbnailUrl) {
}
