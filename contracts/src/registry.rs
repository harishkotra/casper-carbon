use odra::casper_types::U256;
use odra::prelude::*;
use odra::ContractRef;

use crate::agent_registry::{AgentRegistryContractRef, AgentType};
use crate::token::CarbonCreditTokenContractRef;

#[odra::module]
pub struct CarbonProjectRegistry {
    projects: Mapping<u32, Project>,
    next_project_id: Var<u32>,
    agent_registry: Var<Address>,
    token_contract: Var<Address>,
    admin: Var<Address>,
}

#[odra::odra_type]
pub enum ProjectStatus {
    Pending,
    Verified,
    Active,
    Slashed,
}

#[odra::odra_type]
pub struct Project {
    pub id: u32,
    pub name: String,
    pub metadata_hash: String,
    pub location: String,
    pub verifier: Address,
    pub status: ProjectStatus,
    pub verification_score: u8,
    pub total_credit_supply: U256,
    pub minted_supply: U256,
    pub created_at: u64,
    pub verified_at: Option<u64>,
    pub reasoning_hash: String,
}

#[odra::module]
impl CarbonProjectRegistry {
    pub fn init(&mut self, admin: Address) {
        self.admin.set(admin);
        self.next_project_id.set(0);
    }

    pub fn set_agent_registry(&mut self, agent_registry: Address) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }
        self.agent_registry.set(agent_registry);
    }

    pub fn set_token_contract(&mut self, token_contract: Address) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }
        self.token_contract.set(token_contract);
    }

    pub fn register_project(
        &mut self,
        name: String,
        metadata_hash: String,
        location: String,
    ) -> u32 {
        let id = self.next_project_id.get_or_default();
        let caller = self.env().caller();

        let project = Project {
            id,
            name,
            metadata_hash,
            location,
            verifier: caller,
            status: ProjectStatus::Pending,
            verification_score: 0,
            total_credit_supply: U256::zero(),
            minted_supply: U256::zero(),
            created_at: self.env().get_block_time(),
            verified_at: None,
            reasoning_hash: String::new(),
        };

        self.projects.set(&id, project);
        self.next_project_id.set(id + 1);
        id
    }

    pub fn verify_project(
        &mut self,
        project_id: u32,
        score: u8,
        credit_supply: U256,
        reasoning_hash: String,
    ) {
        let caller = self.env().caller();
        self.require_agent_auth(&caller, &AgentType::Verifier);

        let mut project = self
            .projects
            .get(&project_id)
            .unwrap_or_revert_with(self, Error::ProjectNotFound);

        if project.status != ProjectStatus::Pending {
            self.env().revert(Error::ProjectAlreadyVerified);
        }

        project.status = ProjectStatus::Verified;
        project.verification_score = score;
        project.total_credit_supply = credit_supply;
        project.verified_at = Some(self.env().get_block_time());
        project.verifier = caller;
        project.reasoning_hash = reasoning_hash;

        self.projects.set(&project_id, project);
        self.record_agent_success(&caller, true);

        if let Some(token_addr) = self.token_contract.get() {
            let mut token_ref = CarbonCreditTokenContractRef::new(self.env(), token_addr);
            token_ref.mint(&caller, &credit_supply);
        }
    }

    pub fn activate_project(&mut self, project_id: u32) {
        let mut project = self
            .projects
            .get(&project_id)
            .unwrap_or_revert_with(self, Error::ProjectNotFound);

        if project.status != ProjectStatus::Verified {
            self.env().revert(Error::ProjectNotVerified);
        }

        let caller = self.env().caller();
        if caller != project.verifier {
            self.env().revert(Error::Unauthorized);
        }

        project.status = ProjectStatus::Active;
        self.projects.set(&project_id, project);
    }

    pub fn slash_project(&mut self, project_id: u32, reason_hash: String) {
        let caller = self.env().caller();
        self.require_agent_auth(&caller, &AgentType::Compliance);

        let mut project = self
            .projects
            .get(&project_id)
            .unwrap_or_revert_with(self, Error::ProjectNotFound);

        if project.status == ProjectStatus::Slashed {
            self.env().revert(Error::ProjectAlreadySlashed);
        }

        project.status = ProjectStatus::Slashed;
        project.reasoning_hash = reason_hash;
        self.projects.set(&project_id, project);
    }

    pub fn get_project(&self, project_id: u32) -> Option<Project> {
        self.projects.get(&project_id)
    }

    pub fn get_next_project_id(&self) -> u32 {
        self.next_project_id.get_or_default()
    }

    fn require_agent_auth(&self, address: &Address, agent_type: &AgentType) {
        let registry_addr = self
            .agent_registry
            .get()
            .unwrap_or_revert_with(self, Error::AgentRegistryNotSet);
        let registry = AgentRegistryContractRef::new(self.env(), registry_addr);
        if !registry.is_authorized(address, agent_type) {
            self.env().revert(Error::Unauthorized);
        }
    }

    fn record_agent_success(&self, address: &Address, success: bool) {
        if let Some(registry_addr) = self.agent_registry.get() {
            let mut registry = AgentRegistryContractRef::new(self.env(), registry_addr);
            registry.record_verification(address, success);
        }
    }
}

#[odra::odra_error]
pub enum Error {
    ProjectNotFound = 1,
    ProjectAlreadyVerified = 2,
    ProjectNotVerified = 3,
    Unauthorized = 4,
    ExceedsCreditSupply = 5,
    AgentRegistryNotSet = 6,
    TokenContractNotSet = 7,
    ProjectAlreadySlashed = 8,
    AgentNotFound = 9,
    AdminNotSet = 10,
}

#[cfg(test)]
mod tests {
    use odra::casper_types::U256;
    use odra::host::{Deployer, HostEnv, HostRef};
    use odra::prelude::*;

    use crate::agent_registry::{
        AgentRegistry, AgentRegistryHostRef, AgentRegistryInitArgs, AgentType,
    };

    use super::*;

    struct TestEnv {
        env: HostEnv,
        registry: CarbonProjectRegistryHostRef,
        agent_registry: AgentRegistryHostRef,
        admin: Address,
        verifier: Address,
        compliance: Address,
    }

    fn setup() -> TestEnv {
        let env = odra_test::env();
        let admin = env.get_account(0);
        let verifier = env.get_account(1);
        let compliance = env.get_account(2);

        let mut agent_registry = AgentRegistry::deploy(&env, AgentRegistryInitArgs { admin });
        agent_registry.register_agent(verifier, "Verifier One".to_string(), AgentType::Verifier);
        agent_registry.register_agent(compliance, "Compliance One".to_string(), AgentType::Compliance);

        let mut registry = CarbonProjectRegistry::deploy(&env, CarbonProjectRegistryInitArgs { admin });
        registry.set_agent_registry(agent_registry.address());

        TestEnv {
            env,
            registry,
            agent_registry,
            admin,
            verifier,
            compliance,
        }
    }

    #[test]
    fn init_sets_admin() {
        let mut test = setup();
        let next_id = test.registry.get_next_project_id();
        assert_eq!(next_id, 0);
    }

    #[test]
    fn register_project() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash1".to_string(),
            "Brazil".to_string(),
        );
        assert_eq!(id, 0);

        let project = test.registry.get_project(0).unwrap();
        assert_eq!(project.name, "Forest Reserve");
        assert_eq!(project.status, ProjectStatus::Pending);
        assert_eq!(test.registry.get_next_project_id(), 1);
    }

    #[test]
    fn verify_project_requires_verifier() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        test.env.set_caller(test.verifier);
        test.registry.verify_project(
            id,
            85,
            U256::from(10000),
            "ipfs://reasoning".to_string(),
        );

        let project = test.registry.get_project(id).unwrap();
        assert_eq!(project.status, ProjectStatus::Verified);
        assert_eq!(project.verification_score, 85);
        assert_eq!(project.verifier, test.verifier);
        assert!(project.verified_at.is_some());
    }

    #[test]
    fn verify_project_fails_if_not_verifier() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        let non_verifier = test.env.get_account(5);
        test.env.set_caller(non_verifier);
        let err = test
            .registry
            .try_verify_project(id, 85, U256::from(10000), "ipfs://reasoning".to_string())
            .unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn activate_project() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        test.env.set_caller(test.verifier);
        test.registry.verify_project(
            id,
            85,
            U256::from(10000),
            "ipfs://reasoning".to_string(),
        );

        test.registry.activate_project(id);

        let project = test.registry.get_project(id).unwrap();
        assert_eq!(project.status, ProjectStatus::Active);
    }

    #[test]
    fn slash_project_requires_compliance() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        test.env.set_caller(test.verifier);
        test.registry.verify_project(
            id,
            85,
            U256::from(10000),
            "ipfs://reasoning".to_string(),
        );
        test.registry.activate_project(id);

        test.env.set_caller(test.compliance);
        test.registry.slash_project(id, "ipfs://fraud".to_string());

        let project = test.registry.get_project(id).unwrap();
        assert_eq!(project.status, ProjectStatus::Slashed);
    }

    #[test]
    fn cannot_slash_already_slashed() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        test.env.set_caller(test.verifier);
        test.registry.verify_project(id, 85, U256::from(10000), "ipfs://reasoning".to_string());
        test.registry.activate_project(id);

        test.env.set_caller(test.compliance);
        test.registry.slash_project(id, "ipfs://fraud".to_string());

        let err = test
            .registry
            .try_slash_project(id, "ipfs://again".to_string())
            .unwrap_err();
        assert_eq!(err, Error::ProjectAlreadySlashed.into());
    }

    #[test]
    fn cannot_verify_already_verified_project() {
        let mut test = setup();
        let id = test.registry.register_project(
            "Forest Reserve".to_string(),
            "ipfs://QmHash".to_string(),
            "Brazil".to_string(),
        );

        test.env.set_caller(test.verifier);
        test.registry.verify_project(id, 85, U256::from(10000), "ipfs://r1".to_string());

        let err = test
            .registry
            .try_verify_project(id, 90, U256::from(20000), "ipfs://r2".to_string())
            .unwrap_err();
        assert_eq!(err, Error::ProjectAlreadyVerified.into());
    }

    #[test]
    fn get_nonexistent_project_returns_none() {
        let mut test = setup();
        assert_eq!(test.registry.get_project(99), None);
    }

    #[test]
    fn set_token_contract() {
        let mut test = setup();
        let token_addr = test.env.get_account(10);
        test.registry.set_token_contract(token_addr);
    }

    #[test]
    fn non_admin_cannot_set_agent_registry() {
        let mut test = setup();
        let attacker = test.env.get_account(9);
        test.env.set_caller(attacker);
        let err = test
            .registry
            .try_set_agent_registry(test.agent_registry.address())
            .unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn verify_project_fails_without_agent_registry() {
        let env = odra_test::env();
        let admin = env.get_account(0);
        let mut registry = CarbonProjectRegistry::deploy(&env, CarbonProjectRegistryInitArgs { admin });
        let id = registry.register_project(
            "Test".to_string(),
            "ipfs://hash".to_string(),
            "Loc".to_string(),
        );
        let err = registry
            .try_verify_project(id, 80, U256::from(1000), "reason".to_string())
            .unwrap_err();
        assert_eq!(err, Error::AgentRegistryNotSet.into());
    }
}
