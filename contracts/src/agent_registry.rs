use odra::prelude::*;

#[odra::module]
pub struct AgentRegistry {
    agents: Mapping<Address, AgentInfo>,
    agent_count: Var<u32>,
    admin: Var<Address>,
}

#[odra::odra_type]
pub enum AgentType {
    Verifier,
    Market,
    Compliance,
}

#[odra::odra_type]
pub struct AgentInfo {
    pub address: Address,
    pub name: String,
    pub agent_type: AgentType,
    pub reputation_score: u32,
    pub total_verifications: u32,
    pub successful_verifications: u32,
    pub is_active: bool,
}

#[odra::module]
impl AgentRegistry {
    pub fn init(&mut self, admin: Address) {
        self.admin.set(admin);
        self.agent_count.set(0);
    }

    pub fn register_agent(
        &mut self,
        address: Address,
        name: String,
        agent_type: AgentType,
    ) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }

        let agent = AgentInfo {
            address,
            name,
            agent_type,
            reputation_score: 100,
            total_verifications: 0,
            successful_verifications: 0,
            is_active: true,
        };

        self.agents.set(&address, agent);
        let count = self.agent_count.get_or_default();
        self.agent_count.set(count + 1);
    }

    pub fn remove_agent(&mut self, address: &Address) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }

        let mut agent = self
            .agents
            .get(address)
            .unwrap_or_revert_with(self, Error::AgentNotFound);
        agent.is_active = false;
        self.agents.set(address, agent);
    }

    pub fn get_agent(&self, address: &Address) -> Option<AgentInfo> {
        self.agents.get(address)
    }

    pub fn is_authorized(&self, address: &Address, agent_type: &AgentType) -> bool {
        match self.agents.get(address) {
            Some(agent) => agent.is_active && agent.agent_type == *agent_type,
            None => false,
        }
    }

    pub fn record_verification(&mut self, address: &Address, success: bool) {
        let mut agent = self
            .agents
            .get(address)
            .unwrap_or_revert_with(self, Error::AgentNotFound);
        agent.total_verifications += 1;
        if success {
            agent.successful_verifications += 1;
            agent.reputation_score = agent.reputation_score.saturating_add(1);
        } else {
            agent.reputation_score =
                agent.reputation_score.saturating_sub(5).max(1);
        }
        self.agents.set(address, agent);
    }

    pub fn slash_reputation(&mut self, address: &Address, amount: u32) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }

        let mut agent = self
            .agents
            .get(address)
            .unwrap_or_revert_with(self, Error::AgentNotFound);
        agent.reputation_score = agent.reputation_score.saturating_sub(amount);
        self.agents.set(address, agent);
    }

    pub fn agent_count(&self) -> u32 {
        self.agent_count.get_or_default()
    }

    pub fn get_admin(&self) -> Option<Address> {
        self.admin.get()
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    AgentNotFound = 2,
    AdminNotSet = 3,
}

#[cfg(test)]
mod tests {
    use odra::host::{Deployer, HostEnv, HostRef};
    use odra::prelude::*;

    use super::*;

    fn setup() -> (HostEnv, AgentRegistryHostRef) {
        let env = odra_test::env();
        let admin = env.get_account(0);
        let contract = AgentRegistry::deploy(&env, AgentRegistryInitArgs { admin });
        (env, contract)
    }

    #[test]
    fn init_sets_admin() {
        let (env, contract) = setup();
        let admin = env.get_account(0);
        assert_eq!(contract.get_admin(), Some(admin));
        assert_eq!(contract.agent_count(), 0);
    }

    #[test]
    fn admin_registers_agent() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);

        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.name, "Alice");
        assert_eq!(agent.agent_type, AgentType::Verifier);
        assert_eq!(agent.reputation_score, 100);
        assert!(agent.is_active);
        assert_eq!(contract.agent_count(), 1);
    }

    #[test]
    fn non_admin_cannot_register_agent() {
        let (env, mut contract) = setup();
        let non_admin = env.get_account(1);
        let agent_addr = env.get_account(2);

        env.set_caller(non_admin);
        let err = contract
            .try_register_agent(agent_addr, "Bob".to_string(), AgentType::Market)
            .unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn admin_removes_agent() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);

        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        let agent = contract.get_agent(&agent_addr).unwrap();
        assert!(agent.is_active);

        contract.remove_agent(&agent_addr);

        let agent = contract.get_agent(&agent_addr).unwrap();
        assert!(!agent.is_active);
    }

    #[test]
    fn remove_nonexistent_agent_fails() {
        let (env, mut contract) = setup();
        let fake_addr = env.get_account(5);
        let err = contract
            .try_remove_agent(&fake_addr)
            .unwrap_err();
        assert_eq!(err, Error::AgentNotFound.into());
    }

    #[test]
    fn is_authorized_checks_type_and_active() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);

        contract.register_agent(agent_addr, "Verifier".to_string(), AgentType::Verifier);

        assert!(contract.is_authorized(&agent_addr, &AgentType::Verifier));
        assert!(!contract.is_authorized(&agent_addr, &AgentType::Compliance));
        assert!(!contract.is_authorized(&agent_addr, &AgentType::Market));

        contract.remove_agent(&agent_addr);
        assert!(!contract.is_authorized(&agent_addr, &AgentType::Verifier));
    }

    #[test]
    fn is_authorized_returns_false_for_nonexistent() {
        let (env, contract) = setup();
        assert!(!contract.is_authorized(&env.get_account(5), &AgentType::Verifier));
    }

    #[test]
    fn record_verification_tracks_successes() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);
        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        contract.record_verification(&agent_addr, true);
        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.total_verifications, 1);
        assert_eq!(agent.successful_verifications, 1);
        assert_eq!(agent.reputation_score, 101);

        contract.record_verification(&agent_addr, true);
        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.total_verifications, 2);
        assert_eq!(agent.reputation_score, 102);
    }

    #[test]
    fn record_verification_failure_drops_reputation() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);
        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        contract.record_verification(&agent_addr, false);
        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.total_verifications, 1);
        assert_eq!(agent.successful_verifications, 0);
        assert_eq!(agent.reputation_score, 95);
    }

    #[test]
    fn record_verification_reputation_floor_is_one() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);
        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        for _ in 0..25 {
            contract.record_verification(&agent_addr, false);
        }
        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.reputation_score, 1);
    }

    #[test]
    fn record_verification_nonexistent_agent_fails() {
        let (env, mut contract) = setup();
        let err = contract
            .try_record_verification(&env.get_account(5), true)
            .unwrap_err();
        assert_eq!(err, Error::AgentNotFound.into());
    }

    #[test]
    fn admin_slashes_reputation() {
        let (env, mut contract) = setup();
        let agent_addr = env.get_account(1);
        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        contract.slash_reputation(&agent_addr, 30);
        let agent = contract.get_agent(&agent_addr).unwrap();
        assert_eq!(agent.reputation_score, 70);
    }

    #[test]
    fn non_admin_cannot_slash() {
        let (env, mut contract) = setup();
        let non_admin = env.get_account(1);
        let agent_addr = env.get_account(2);

        env.set_caller(env.get_account(0));
        contract.register_agent(agent_addr, "Alice".to_string(), AgentType::Verifier);

        env.set_caller(non_admin);
        let err = contract.try_slash_reputation(&agent_addr, 10).unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn get_agent_returns_none_for_missing() {
        let (env, contract) = setup();
        assert_eq!(contract.get_agent(&env.get_account(5)), None);
    }
}
