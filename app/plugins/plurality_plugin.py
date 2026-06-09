"""
app/plugins/plurality_plugin.py
────────────────────────────────
Plurality (First-Past-the-Post) tallying plugin.
Each voter picks exactly one candidate. Most votes wins.
"""

from collections import Counter
from app.core.plugin_interface import TallyingPlugin


class Plugin(TallyingPlugin):

    @property
    def method_name(self) -> str:
        return "plurality"

    def define_ballot_structure(self) -> dict:
        return {
            "type": "single_choice",
            "description": "Select exactly one candidate.",
            "fields": {
                "choice": {
                    "type": "string",
                    "required": True,
                    "description": "Name or ID of your chosen candidate.",
                }
            },
        }

    def validate_ballot(self, ballot: dict) -> tuple[bool, list[str]]:
        errors = []
        if "choice" not in ballot:
            errors.append("Missing required field: 'choice'.")
        elif not isinstance(ballot["choice"], str) or not ballot["choice"].strip():
            errors.append("Field 'choice' must be a non-empty string.")
        return (len(errors) == 0, errors)

    def count_votes(self, ballots: list[dict]) -> dict:
        tally: Counter = Counter()
        valid_count = 0
        for b in ballots:
            ok, _ = self.validate_ballot(b)
            if ok:
                tally[b["choice"].strip()] += 1
                valid_count += 1

        if not tally:
            return {"winner": None, "tally": {}, "rounds": [], "valid_ballots": 0}

        winner = tally.most_common(1)[0][0]
        return {
            "winner": winner,
            "tally": dict(tally),
            "rounds": [dict(tally)],
            "valid_ballots": valid_count,
        }

    def describe_results(self, result: dict) -> str:
        if result["winner"] is None:
            return "No valid ballots were cast."
        lines = [
            f"Election method: Plurality (First-Past-the-Post)",
            f"Total valid ballots: {result['valid_ballots']}",
            "",
            "Vote counts:",
        ]
        sorted_tally = sorted(result["tally"].items(), key=lambda x: -x[1])
        for candidate, votes in sorted_tally:
            pct = (votes / result["valid_ballots"] * 100) if result["valid_ballots"] else 0
            marker = " ← WINNER" if candidate == result["winner"] else ""
            lines.append(f"  {candidate}: {votes} votes ({pct:.1f}%){marker}")
        return "\n".join(lines)
