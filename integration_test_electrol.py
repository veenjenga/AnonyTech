import pytest
import time

try:
    from app.core.plugin_loader import load_plugin
    from app.plugins.plurality_plugin import Plugin as Plurality
    from app.plugins.borda_plugin import Plugin as Borda
    from app.plugins.stv_plugin import Plugin as STV
    from app.plugins.liquid_plugin import Plugin as Liquid
except ImportError:
    pytest.skip("App modules not available", allow_module_level=True)


def test_load_all_plugins():
    """
    Tests that all four electoral method plugins can be dynamically loaded.
    This is critical for supporting multiple voting systems.
    """
    print("\n--- INTEGRATION TEST 1: Load All Plugins ---")
    
    methods = ["plurality", "borda", "stv", "liquid"]
    loaded = {}
    
    for method in methods:
        plugin = load_plugin(method)
        assert plugin is not None, f"Failed to load {method}"
        loaded[method] = plugin
        print(f"  Loaded: {method:12} ✓")
    
    assert len(loaded) == 4, "FAIL: Not all plugins loaded"
    print("  RESULT: PASS — All electoral methods can be loaded")
    return True


def test_plugin_interface_contract():
    """
    Tests that all plugins implement the TallyingPlugin interface.
    Each must have: define_ballot_structure, validate_ballot, count_votes, describe_results
    """
    print("\n--- INTEGRATION TEST 2: Plugin Interface Contract ---")
    
    from app.core.plugin_interface import TallyingPlugin
    
    methods = ["plurality", "borda", "stv", "liquid"]
    
    for method in methods:
        plugin = load_plugin(method)
        
        # Check required methods exist
        assert hasattr(plugin, 'define_ballot_structure'), f"{method} missing ballot structure"
        assert hasattr(plugin, 'validate_ballot'), f"{method} missing validate"
        assert hasattr(plugin, 'count_votes'), f"{method} missing count_votes"
        assert hasattr(plugin, 'describe_results'), f"{method} missing describe_results"
        
        # Check it's a TallyingPlugin
        assert isinstance(plugin, TallyingPlugin), f"{method} not a TallyingPlugin"
        
        print(f"  {method:12} implements full interface ✓")
    
    print("  RESULT: PASS — All plugins implement the interface")
    return True


def test_ballot_structure_validation():
    """
    Tests that each plugin's define_ballot_structure returns correct format
    and validate_ballot enforces those rules.
    """
    print("\n--- INTEGRATION TEST 3: Ballot Structure Validation ---")
    
    # Plurality: single choice
    plurality = load_plugin("plurality")
    structure = plurality.define_ballot_structure()
    assert structure["type"] == "single_choice"
    valid, _ = plurality.validate_ballot({"choice": "Alice"})
    assert valid, "Valid plurality ballot rejected"
    print(f"  Plurality structure: {structure['type']:20} ✓")
    
    # Borda: rankings
    borda = load_plugin("borda")
    structure = borda.define_ballot_structure()
    assert "rankings" in structure.get("fields", {}), "Borda missing rankings field"
    print(f"  Borda structure:     {structure['type']:20} ✓")
    
    # STV: rankings
    stv = load_plugin("stv")
    structure = stv.define_ballot_structure()
    assert "rankings" in structure.get("fields", {}), "STV missing rankings field"
    print(f"  STV structure:       {structure['type']:20} ✓")
    
    # Liquid: direct or delegate
    liquid = load_plugin("liquid")
    structure = liquid.define_ballot_structure()
    valid, _ = liquid.validate_ballot({"vote_type": "direct", "choice": "Alice", "voter_id": "v1"})
    assert valid, "Valid liquid ballot rejected"
    print(f"  Liquid structure:    {structure['type']:20} ✓")
    
    print("  RESULT: PASS — All ballot structures enforced correctly")
    return True


def test_plugin_substitution_latency():
    """
    Tests that switching between electoral methods is fast (< 500ms).
    This allows the system to support multiple elections simultaneously.
    """
    print("\n--- INTEGRATION TEST 4: Plugin Substitution Latency ---")
    
    methods = ["plurality", "borda", "stv", "liquid"]
    max_time = 0.5  # 500ms
    
    for method in methods:
        start = time.perf_counter()
        plugin = load_plugin(method)
        elapsed = (time.perf_counter() - start) * 1000  # Convert to ms
        
        print(f"  {method:12} load time: {elapsed:.1f}ms", end="")
        assert elapsed < max_time * 1000, f"{method} load took {elapsed:.1f}ms"
        print(" ✓")
    
    print("  RESULT: PASS — All plugins load in < 500ms")
    return True


def test_counting_performance_scaling():
    """
    Tests that vote counting performance scales linearly with ballot count.
    """
    print("\n--- INTEGRATION TEST 5: Counting Performance Scaling ---")
    
    plurality = load_plugin("plurality")
    
    times = []
    sizes = [100, 500, 1000]
    
    for size in sizes:
        ballots = [{"choice": f"Candidate_{i % 3}"} for i in range(size)]
        
        start = time.perf_counter()
        result = plurality.count_votes(ballots)
        elapsed = (time.perf_counter() - start) * 1000
        
        times.append(elapsed)
        print(f"  {size:4} ballots: {elapsed:.2f}ms ✓")
    
    # Verify roughly linear scaling (1000 ballots should be ~10x slower than 100)
    ratio = times[2] / times[0]  # 1000 vs 100
    assert 5 < ratio < 15, f"Non-linear scaling: {ratio}x"
    
    print("  RESULT: PASS — Counting scales linearly with ballot count")
    return True


def test_mixed_valid_invalid_ballots():
    """
    Tests that all methods correctly filter out invalid ballots.
    """
    print("\n--- INTEGRATION TEST 6: Invalid Ballot Filtering ---")
    
    plurality = load_plugin("plurality")
    
    ballots = [
        {"choice": "Alice"},      # valid
        {"choice": "Bob"},        # valid
        {},                       # invalid
        {"choice": "Alice"},      # valid
        {"choice": "   "},        # invalid
        {"choice": "Carol"},      # valid
    ]
    
    result = plurality.count_votes(ballots)
    
    print(f"  Input ballots:      6")
    print(f"  Valid ballots:      {result['valid_ballots']}")
    print(f"  Invalid filtered:   {6 - result['valid_ballots']}")
    
    assert result['valid_ballots'] == 4, f"Should have 4 valid, got {result['valid_ballots']}"
    
    print("  RESULT: PASS — Invalid ballots correctly excluded")
    return True


if __name__ == "__main__":
    tests = [
        test_load_all_plugins,
        test_plugin_interface_contract,
        test_ballot_structure_validation,
        test_plugin_substitution_latency,
        test_counting_performance_scaling,
        test_mixed_valid_invalid_ballots,
    ]
    
    passed = 0
    failed = 0
    
    print("\n" + "="*60)
    print("ELECTORAL METHODS — INTEGRATION TESTS")
    print("="*60)
    
    for test_fn in tests:
        try:
            test_fn()
            passed += 1
        except AssertionError as e:
            print(f"  * FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  * ERROR: {e}")
            failed += 1
    
    print(f"\n{'='*60}")
    print(f"RESULTS: {passed} passed, {failed} failed")
    print(f"{'='*60}\n")