"""Configurable N-of-M TezOracle SmartPy contract.

Testnet and non-authoritative shadow only. One artifact; N, M, and class
minima are origination/governance parameters, never compiled-in 3-of-4.
"""

from __future__ import annotations
import smartpy as sp


@sp.module
def main():
    DOMAIN = "TEZORACLE_V1"
    MAX_SIGNERS = 16
    DIGEST_BYTES = 32
    DECIMALS_MAX = 18

    t_asset_entry: type = sp.record(
        asset_id=sp.string,
        price=sp.nat,
        decimals=sp.nat,
        observation_time=sp.timestamp,
    ).layout(("asset_id", ("price", ("decimals", "observation_time"))))

    t_payload: type = sp.record(
        domain=sp.string,
        chain_id=sp.chain_id,
        oracle_address=sp.address,
        config_version=sp.nat,
        policy_hash=sp.bytes,
        publication_group=sp.string,
        round=sp.nat,
        valid_from=sp.timestamp,
        valid_until=sp.timestamp,
        evidence_digest=sp.bytes,
        assets=sp.list[t_asset_entry],
    ).layout(
        (
            "domain",
            (
                "chain_id",
                (
                    "oracle_address",
                    (
                        "config_version",
                        (
                            "policy_hash",
                            (
                                "publication_group",
                                (
                                    "round",
                                    (
                                        "valid_from",
                                        ("valid_until", ("evidence_digest", "assets")),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )
    )

    t_signature_entry: type = sp.record(
        index=sp.nat, signature=sp.signature
    ).layout(("index", "signature"))

    t_view_quote: type = sp.record(
        price=sp.nat, observation_time=sp.timestamp
    ).layout(("price", "observation_time"))

    t_signer: type = sp.record(
        public_key=sp.key, class_id=sp.string, active=sp.bool
    ).layout(("public_key", ("class_id", "active")))

    t_asset_policy: type = sp.record(
        decimals=sp.nat,
        max_observation_age_seconds=sp.nat,
        absolute_min_price=sp.nat,
        absolute_max_price=sp.nat,
        max_movement_bps=sp.nat,
    ).layout(
        (
            "decimals",
            (
                "max_observation_age_seconds",
                ("absolute_min_price", ("absolute_max_price", "max_movement_bps")),
            ),
        )
    )

    t_quote: type = sp.record(
        price=sp.nat,
        observation_time=sp.timestamp,
        round=sp.nat,
        config_version=sp.nat,
        accepted_level=sp.nat,
    ).layout(
        (
            "price",
            ("observation_time", ("round", ("config_version", "accepted_level"))),
        )
    )

    t_pending_quote: type = sp.record(
        price=sp.nat,
        observation_time=sp.timestamp,
        round=sp.nat,
        config_version=sp.nat,
        accepted_level=sp.nat,
        activation_level=sp.nat,
    ).layout(
        (
            "price",
            (
                "observation_time",
                (
                    "round",
                    ("config_version", ("accepted_level", "activation_level")),
                ),
            ),
        )
    )

    t_asset_state: type = sp.record(
        decimals=sp.nat,
        max_observation_age_seconds=sp.nat,
        absolute_min_price=sp.nat,
        absolute_max_price=sp.nat,
        max_movement_bps=sp.nat,
        paused=sp.bool,
        pending_unpause_level=sp.option[sp.nat],
        last_observation_time=sp.timestamp,
        active=sp.option[t_quote],
        pending=sp.option[t_pending_quote],
    ).layout(
        (
            "decimals",
            (
                "max_observation_age_seconds",
                (
                    "absolute_min_price",
                    (
                        "absolute_max_price",
                        (
                            "max_movement_bps",
                            (
                                "paused",
                                (
                                    "pending_unpause_level",
                                    (
                                        "last_observation_time",
                                        ("active", "pending"),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )
    )

    t_init: type = sp.record(
        admin=sp.address,
        guardian=sp.address,
        config_version=sp.nat,
        policy_hash=sp.bytes,
        threshold_n=sp.nat,
        threshold_m=sp.nat,
        activation_delay_levels=sp.nat,
        min_activation_delay_levels=sp.nat,
        max_clock_skew_seconds=sp.nat,
        validity_window_seconds=sp.nat,
        price_nat_max=sp.nat,
        signers=sp.map[sp.nat, t_signer],
        class_minima=sp.map[sp.string, sp.nat],
        groups=sp.map[sp.string, sp.list[sp.string]],
        assets=sp.map[sp.string, t_asset_policy],
    )

    t_pending_config: type = sp.record(activate_at_level=sp.nat, init=t_init).layout(
        ("activate_at_level", "init")
    )

    def assert_quorum_config(p):
        threshold_n = p.threshold_n
        threshold_m = p.threshold_m
        signers = p.signers
        class_minima = p.class_minima
        assert threshold_n >= 1, "BAD_CONFIG"
        assert threshold_m >= 1, "BAD_CONFIG"
        assert threshold_n <= threshold_m, "BAD_CONFIG"
        assert threshold_m <= MAX_SIGNERS, "BAD_CONFIG"
        active_count = 0
        class_totals = {}
        for item in signers.items():
            assert sp.len(item.value.class_id) >= 1, "BAD_CONFIG"
            if item.value.active:
                active_count += 1
                prev = class_totals.get(item.value.class_id, default=0)
                class_totals[item.value.class_id] = prev + 1
            for other in signers.items():
                if item.key < other.key:
                    assert item.value.public_key != other.value.public_key, "BAD_CONFIG"
        assert active_count == threshold_m, "BAD_CONFIG"
        minima_sum = 0
        for item in class_minima.items():
            minima_sum += item.value
            cap = class_totals.get(item.key, default=0)
            assert item.value <= cap, "BAD_CONFIG"
        assert minima_sum <= threshold_n, "BAD_CONFIG"
        return True

    def assert_asset_groups(p):
        groups = p.groups
        assets = p.assets
        seen = {}
        group_count = 0
        for g in groups.items():
            group_count += 1
            assert sp.len(g.key) >= 1, "BAD_CONFIG"
            assert sp.len(g.value) >= 1, "BAD_CONFIG"
            for aid in g.value:
                assert aid in assets, "BAD_CONFIG"
                assert not (aid in seen), "BAD_CONFIG"
                seen[aid] = True
        assert group_count >= 1, "BAD_CONFIG"
        assert sp.len(seen) == sp.len(assets), "BAD_CONFIG"
        return True

    def assert_init_params(init):
        sp.cast(init, t_init)
        assert init.config_version >= 1, "BAD_CONFIG"
        assert sp.len(init.policy_hash) == DIGEST_BYTES, "POLICY"
        assert init.min_activation_delay_levels >= 1, "BAD_CONFIG"
        assert (
            init.activation_delay_levels >= init.min_activation_delay_levels
        ), "BAD_CONFIG"
        assert init.max_clock_skew_seconds >= 0, "BAD_CONFIG"
        assert init.validity_window_seconds >= 1, "BAD_CONFIG"
        assert init.price_nat_max >= 1, "BAD_CONFIG"
        assert assert_quorum_config(
            sp.record(
                threshold_n=init.threshold_n,
                threshold_m=init.threshold_m,
                signers=init.signers,
                class_minima=init.class_minima,
            )
        )
        assert assert_asset_groups(sp.record(groups=init.groups, assets=init.assets))
        for item in init.assets.items():
            assert item.value.decimals <= DECIMALS_MAX, "BAD_CONFIG"
            assert item.value.max_observation_age_seconds >= 1, "BAD_CONFIG"
            assert item.value.absolute_min_price >= 1, "BAD_CONFIG"
            assert item.value.absolute_max_price >= item.value.absolute_min_price, "BAD_CONFIG"
        return True

    def build_asset_states(policies):
        built = {}
        for item in policies.items():
            built[item.key] = sp.record(
                decimals=item.value.decimals,
                max_observation_age_seconds=item.value.max_observation_age_seconds,
                absolute_min_price=item.value.absolute_min_price,
                absolute_max_price=item.value.absolute_max_price,
                max_movement_bps=item.value.max_movement_bps,
                paused=False,
                pending_unpause_level=None,
                last_observation_time=sp.timestamp(0),
                active=None,
                pending=None,
            )
        return built

    def movement_exceeded(p):
        old_price = p.old_price
        new_price = p.new_price
        max_bps = p.max_bps
        exceeded = False
        if new_price >= old_price:
            delta = sp.as_nat(new_price - old_price)
            exceeded = delta * 10000 > max_bps * old_price
        else:
            delta = sp.as_nat(old_price - new_price)
            exceeded = delta * 10000 > max_bps * old_price
        return exceeded

    class Packer(sp.Contract):
        def __init__(self):
            self.data.packed = sp.bytes("0x")

        @sp.entrypoint
        def pack_payload(self, payload):
            sp.cast(payload, t_payload)
            self.data.packed = sp.pack(payload)

    class TezOracle(sp.Contract):
        def __init__(self, init):
            assert assert_init_params(init)
            self.data.admin = init.admin
            self.data.guardian = init.guardian
            self.data.paused = False
            self.data.pending_unpause_level = None
            self.data.config_version = init.config_version
            self.data.policy_hash = init.policy_hash
            self.data.threshold_n = init.threshold_n
            self.data.threshold_m = init.threshold_m
            self.data.activation_delay_levels = init.activation_delay_levels
            self.data.min_activation_delay_levels = init.min_activation_delay_levels
            self.data.max_clock_skew_seconds = init.max_clock_skew_seconds
            self.data.validity_window_seconds = init.validity_window_seconds
            self.data.price_nat_max = init.price_nat_max
            self.data.signers = init.signers
            self.data.class_minima = init.class_minima
            self.data.groups = init.groups
            self.data.assets = build_asset_states(init.assets)
            self.data.last_round = {}
            self.data.pending_config = None

        @sp.private(with_storage="read-write")
        def promote_prices(self):
            for item in self.data.assets.items():
                st = item.value
                if st.pending.is_some():
                    pending = st.pending.unwrap_some()
                    if sp.level >= pending.activation_level:
                        accept = True
                        if st.active.is_some():
                            active = st.active.unwrap_some()
                            accept = not movement_exceeded(
                                sp.record(
                                    old_price=active.price,
                                    new_price=pending.price,
                                    max_bps=st.max_movement_bps,
                                )
                            )
                        if accept:
                            st.active = sp.Some(
                                sp.record(
                                    price=pending.price,
                                    observation_time=pending.observation_time,
                                    round=pending.round,
                                    config_version=pending.config_version,
                                    accepted_level=pending.accepted_level,
                                )
                            )
                            st.pending = None
                        else:
                            st.paused = True
                            st.pending = None
                        self.data.assets[item.key] = st

        @sp.private(with_storage="read-write")
        def apply_init(self, init):
            sp.cast(init, t_init)
            merged = {}
            for item in init.assets.items():
                if item.key in self.data.assets:
                    old = self.data.assets[item.key]
                    merged[item.key] = sp.record(
                        decimals=item.value.decimals,
                        max_observation_age_seconds=item.value.max_observation_age_seconds,
                        absolute_min_price=item.value.absolute_min_price,
                        absolute_max_price=item.value.absolute_max_price,
                        max_movement_bps=item.value.max_movement_bps,
                        paused=old.paused,
                        pending_unpause_level=old.pending_unpause_level,
                        last_observation_time=old.last_observation_time,
                        active=old.active,
                        pending=old.pending,
                    )
                else:
                    merged[item.key] = sp.record(
                        decimals=item.value.decimals,
                        max_observation_age_seconds=item.value.max_observation_age_seconds,
                        absolute_min_price=item.value.absolute_min_price,
                        absolute_max_price=item.value.absolute_max_price,
                        max_movement_bps=item.value.max_movement_bps,
                        paused=False,
                        pending_unpause_level=None,
                        last_observation_time=sp.timestamp(0),
                        active=None,
                        pending=None,
                    )
            self.data.admin = init.admin
            self.data.guardian = init.guardian
            self.data.config_version = init.config_version
            self.data.policy_hash = init.policy_hash
            self.data.threshold_n = init.threshold_n
            self.data.threshold_m = init.threshold_m
            self.data.activation_delay_levels = init.activation_delay_levels
            self.data.min_activation_delay_levels = init.min_activation_delay_levels
            self.data.max_clock_skew_seconds = init.max_clock_skew_seconds
            self.data.validity_window_seconds = init.validity_window_seconds
            self.data.price_nat_max = init.price_nat_max
            self.data.signers = init.signers
            self.data.class_minima = init.class_minima
            self.data.groups = init.groups
            self.data.assets = merged

        @sp.private(with_storage="read-only")
        def visible_quote(self, asset_id):
            assert not self.data.paused, "PAUSED"
            st = self.data.assets.get(asset_id, error="ASSET_ID")
            assert not st.paused, "ASSET_PAUSED"
            result = sp.cast(None, sp.option[t_view_quote])
            used_pending = False
            if st.pending.is_some():
                pending = st.pending.unwrap_some()
                if sp.level >= pending.activation_level:
                    accept = True
                    if st.active.is_some():
                        active = st.active.unwrap_some()
                        accept = not movement_exceeded(
                            sp.record(
                                old_price=active.price,
                                new_price=pending.price,
                                max_bps=st.max_movement_bps,
                            )
                        )
                    if accept:
                        result = sp.Some(
                            sp.record(
                                price=pending.price,
                                observation_time=pending.observation_time,
                            )
                        )
                        used_pending = True
            if not used_pending:
                if st.active.is_some():
                    active = st.active.unwrap_some()
                    result = sp.Some(
                        sp.record(
                            price=active.price,
                            observation_time=active.observation_time,
                        )
                    )
            return result.unwrap_some(error="NO_PRICE")

        @sp.onchain_view
        def get_price(self, asset_id):
            return self.visible_quote(asset_id)

        @sp.onchain_view
        def get_price_with_timestamp(self, asset_id):
            return self.visible_quote(asset_id)

        @sp.entrypoint
        def submit(self, payload, signatures):
            sp.cast(payload, t_payload)
            sp.cast(signatures, sp.list[t_signature_entry])
            assert not self.data.paused, "PAUSED"
            self.promote_prices()
            assert payload.domain == DOMAIN, "DOMAIN"
            assert payload.chain_id == sp.chain_id, "CHAIN"
            assert payload.oracle_address == sp.self_address, "ORACLE"
            assert payload.config_version >= 1, "CONFIG"
            assert payload.config_version == self.data.config_version, "CONFIG"
            assert sp.len(payload.policy_hash) == DIGEST_BYTES, "POLICY"
            assert payload.policy_hash == self.data.policy_hash, "POLICY"
            expected = self.data.groups.get(payload.publication_group, error="GROUP")
            assert payload.round >= 1, "ROUND"
            last_round = self.data.last_round.get(payload.publication_group, default=0)
            assert payload.round > last_round, "ROUND"
            assert payload.valid_from < payload.valid_until, "WINDOW"
            assert payload.valid_from <= sp.now, "WINDOW"
            assert sp.now <= payload.valid_until, "WINDOW"
            window = payload.valid_until - payload.valid_from
            assert window <= sp.to_int(self.data.validity_window_seconds), "WINDOW"
            assert sp.len(payload.evidence_digest) == DIGEST_BYTES, "EVIDENCE"
            ids = [a.asset_id for a in payload.assets]
            assert sp.pack(ids) == sp.pack(expected), "ASSETS_SET"
            for asset in payload.assets:
                st = self.data.assets.get(asset.asset_id, error="ASSET_ID")
                assert not st.paused, "ASSET_PAUSED"
                assert asset.decimals == st.decimals, "DECIMALS"
                assert asset.price >= 1, "PRICE"
                assert asset.price <= self.data.price_nat_max, "PRICE"
                assert asset.price >= st.absolute_min_price, "BOUNDS"
                assert asset.price <= st.absolute_max_price, "BOUNDS"
                assert asset.observation_time >= sp.timestamp(1), "OBS_ZERO"
                max_future = sp.add_seconds(
                    sp.now, sp.to_int(self.data.max_clock_skew_seconds)
                )
                assert asset.observation_time <= max_future, "OBS_FUTURE"
                age = sp.now - asset.observation_time
                assert age <= sp.to_int(st.max_observation_age_seconds), "OBS_STALE"
                if st.last_observation_time >= sp.timestamp(1):
                    assert (
                        asset.observation_time >= st.last_observation_time
                    ), "OBS_REGRESS"
            sig_len = sp.len(signatures)
            assert sig_len <= MAX_SIGNERS, "QUORUM"
            assert sig_len >= self.data.threshold_n, "QUORUM"
            packed = sp.pack(payload)
            seen = set()
            valid_count = 0
            class_counts = {}
            for entry in signatures:
                assert not (entry.index in seen), "DUPLICATE"
                seen.add(entry.index)
                signer = self.data.signers.get(entry.index, error="UNKNOWN_SIGNER")
                assert signer.active, "INACTIVE_SIGNER"
                assert sp.check_signature(
                    signer.public_key, entry.signature, packed
                ), "SIGNATURE"
                valid_count += 1
                prev = class_counts.get(signer.class_id, default=0)
                class_counts[signer.class_id] = prev + 1
            assert valid_count >= self.data.threshold_n, "QUORUM"
            for item in self.data.class_minima.items():
                got = class_counts.get(item.key, default=0)
                assert got >= item.value, "CLASS_MIN"
            activation_level = sp.level + self.data.activation_delay_levels
            for asset in payload.assets:
                st = self.data.assets[asset.asset_id]
                st.pending = sp.Some(
                    sp.record(
                        price=asset.price,
                        observation_time=asset.observation_time,
                        round=payload.round,
                        config_version=payload.config_version,
                        accepted_level=sp.level,
                        activation_level=activation_level,
                    )
                )
                st.last_observation_time = asset.observation_time
                self.data.assets[asset.asset_id] = st
            self.data.last_round[payload.publication_group] = payload.round
            sp.emit(
                sp.record(
                    group=payload.publication_group,
                    round=payload.round,
                    config_version=payload.config_version,
                ),
                tag="tezoracle_submit",
            )

        @sp.entrypoint
        def pause(self):
            assert (sp.sender == self.data.admin) or (
                sp.sender == self.data.guardian
            ), "NOT_AUTHORIZED"
            self.promote_prices()
            self.data.paused = True
            self.data.pending_unpause_level = None
            sp.emit(True, tag="tezoracle_pause")

        @sp.entrypoint
        def pause_asset(self, asset_id):
            assert (sp.sender == self.data.admin) or (
                sp.sender == self.data.guardian
            ), "NOT_AUTHORIZED"
            self.promote_prices()
            st = self.data.assets.get(asset_id, error="ASSET_ID")
            st.paused = True
            st.pending_unpause_level = None
            self.data.assets[asset_id] = st
            sp.emit(asset_id, tag="tezoracle_pause")

        @sp.entrypoint
        def propose_unpause(self):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            assert self.data.paused, "NOT_PAUSED"
            self.data.pending_unpause_level = sp.Some(
                sp.level + self.data.activation_delay_levels
            )

        @sp.entrypoint
        def activate_unpause(self):
            self.promote_prices()
            level = self.data.pending_unpause_level.unwrap_some(error="NO_PENDING")
            assert sp.level >= level, "DELAY"
            self.data.paused = False
            self.data.pending_unpause_level = None

        @sp.entrypoint
        def cancel_pending_unpause(self):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            assert self.data.pending_unpause_level.is_some(), "NO_PENDING"
            self.data.pending_unpause_level = None

        @sp.entrypoint
        def propose_asset_unpause(self, asset_id):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            st = self.data.assets.get(asset_id, error="ASSET_ID")
            assert st.paused, "NOT_PAUSED"
            st.pending_unpause_level = sp.Some(
                sp.level + self.data.activation_delay_levels
            )
            self.data.assets[asset_id] = st

        @sp.entrypoint
        def activate_asset_unpause(self, asset_id):
            self.promote_prices()
            st = self.data.assets.get(asset_id, error="ASSET_ID")
            level = st.pending_unpause_level.unwrap_some(error="NO_PENDING")
            assert sp.level >= level, "DELAY"
            st.paused = False
            st.pending_unpause_level = None
            self.data.assets[asset_id] = st

        @sp.entrypoint
        def cancel_asset_unpause(self, asset_id):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            st = self.data.assets.get(asset_id, error="ASSET_ID")
            assert st.pending_unpause_level.is_some(), "NO_PENDING"
            st.pending_unpause_level = None
            self.data.assets[asset_id] = st

        @sp.entrypoint
        def propose_config(self, init):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            assert assert_init_params(init)
            assert init.config_version == self.data.config_version + 1, "CONFIG"
            self.data.pending_config = sp.Some(
                sp.record(
                    activate_at_level=sp.level + self.data.activation_delay_levels,
                    init=init,
                )
            )
            sp.emit(init.config_version, tag="tezoracle_config")

        @sp.entrypoint
        def activate_config(self):
            self.promote_prices()
            pending = self.data.pending_config.unwrap_some(error="NO_PENDING")
            assert sp.level >= pending.activate_at_level, "DELAY"
            self.apply_init(pending.init)
            self.data.pending_config = None
            sp.emit(self.data.config_version, tag="tezoracle_config")

        @sp.entrypoint
        def cancel_pending_config(self):
            assert sp.sender == self.data.admin, "NOT_ADMIN"
            self.promote_prices()
            assert self.data.pending_config.is_some(), "NO_PENDING"
            self.data.pending_config = None
            sp.emit(self.data.config_version, tag="tezoracle_config")
