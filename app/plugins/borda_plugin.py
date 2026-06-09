"""
app/plugins/borda_plugin.py
────────────────────────────
Borda Count tallying plugin.
Voters rank all candidates. Rank 1 (first) gets N-1 points,
rank 2 gets N-2 points, ..., last rank gets 0 points.
"""

from app.core.plugin_interface import TallyingPlugin


class Plugin(TallyingPlugin):

    @property
    def method_name(self) -> str:
        return "borda"

    def define_ballot_structure(self) -> dict:
        return {
            "type": "ranked_choice",
            "description": "Rank ALL candidates from most preferred (1) to least preferred.",
            "fields": {
                "rankings": {
                    "type": "object",
                    "description": "Dict mapping candidate name → rank (1 = most preferred).",
                    "required": True,
                }
            },
        }

    def validate_ballot(self, ballot: dict) -> tuple[bool, list[str]]:
        errors = []
        if "rankings" not in ballot:
            errors.append("Missing required field: 'rankings'.")
            return False, errors

        rankings = ballot["rankings"]
        if not isinstance(rankings, dict) or not rankings:
            errors.append("'rankings' must be a non-empty dict.")
            return False, errors

        ranks = list(rankings.values())
        if not all(isinstance(r, int) and r >= 1 for r in ranks):
            errors.append("All ranks must be positive integers.")
        if len(set(ranks)) != len(ranks):
            errors.append("Ranks must be unique (no ties allowed in standard Borda).")

        return (len(errors) == 0, errors)

    def count_votes(self, ballots: list[dict]) -> dict:
        scores: dict[str, int] = {}
        valid_count = 0

        for b in ballots:
            ok, _ = self.validate_ballot(b)
            if not ok:
                continue
            valid_count += 1
            rankings: dict[str, int] = b["rankings"]
            n = len(rankings)
            for candidate, rank in rankings.items():
                points = n - rank  # rank 1 → n-1 points, rank n → 0 points
                scores[candidate] = scores.get(candidate, 0) + points

        if not scores:
            return {"winner": None, "tally": {}, "rounds": [], "valid_ballots": 0}

        winner = max(scores, key=lambda c: scores[c])
        return {
            "winner": winner,
            "tally": scores,
            "rounds": [scores.copy()],
            "valid_ballots": valid_count,
        }

    def describe_results(self, result: dict) -> str:
        if result["winner"] is None:
            return "No valid ballots were cast."
        lines = [
            "Election method: Borda Count",
            "Candidates are ranked; positional points are summed across all ballots.",
            f"Total valid ballots: {result['valid_ballots']}",
            "",
            "Borda scores:",
        ]
        sorted_scores = sorted(result["tally"].items(), key=lambda x: -x[1])
        for candidate, score in sorted_scores:
            marker = " ← WINNER" if candidate == result["winner"] else ""
            lines.append(f"  {candidate}: {score} points{marker}")
        return "\n".join(lines)
