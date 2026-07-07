use odra::casper_types::U256;
use odra::prelude::*;
use odra_modules::cep18_token::Cep18;

#[odra::module]
pub struct CarbonCreditToken {
    token: SubModule<Cep18>,
    registry_contract: Var<Address>,
}

#[odra::module]
impl CarbonCreditToken {
    pub fn init(
        &mut self,
        name: String,
        symbol: String,
        decimals: u8,
        registry_contract: Address,
    ) {
        self.token.init(symbol, name, decimals, U256::zero());
        self.registry_contract.set(registry_contract);
    }

    pub fn mint(&mut self, to: &Address, amount: &U256) {
        let caller = self.env().caller();
        let registry = self
            .registry_contract
            .get()
            .unwrap_or_revert_with(self, Error::RegistryNotSet);
        if caller != registry {
            self.env().revert(Error::Unauthorized);
        }
        self.token.raw_mint(to, amount);
    }

    pub fn burn(&mut self, from: &Address, amount: &U256) {
        let caller = self.env().caller();
        if caller != *from {
            self.env().revert(Error::Unauthorized);
        }
        self.token.raw_burn(from, amount);
    }

    pub fn transfer(&mut self, to: &Address, amount: &U256) {
        self.token.transfer(to, amount);
    }

    pub fn approve(&mut self, spender: &Address, amount: &U256) {
        self.token.approve(spender, amount);
    }

    pub fn transfer_from(&mut self, from: &Address, to: &Address, amount: &U256) {
        let spender = self.env().caller();
        let allowance = self.token.allowance(from, &spender);
        if allowance < *amount {
            self.env().revert(Error::InsufficientAllowance);
        }
        self.token.raw_approve(from, &spender, &(allowance - *amount));
        self.token.raw_transfer(from, to, amount);
    }

    pub fn balance_of(&self, owner: &Address) -> U256 {
        self.token.balance_of(owner)
    }

    pub fn total_supply(&self) -> U256 {
        self.token.total_supply()
    }

    pub fn allowance(&self, owner: &Address, spender: &Address) -> U256 {
        self.token.allowance(owner, spender)
    }

    pub fn name(&self) -> String {
        self.token.name()
    }

    pub fn symbol(&self) -> String {
        self.token.symbol()
    }

    pub fn decimals(&self) -> u8 {
        self.token.decimals()
    }
}

#[odra::odra_error]
pub enum Error {
    Unauthorized = 1,
    RegistryNotSet = 2,
    InsufficientAllowance = 3,
}

#[cfg(test)]
mod tests {
    use odra::casper_types::U256;
    use odra::host::{Deployer, HostEnv, HostRef};
    use odra::prelude::*;

    use super::*;

    fn setup() -> (HostEnv, CarbonCreditTokenHostRef, Address) {
        let env = odra_test::env();
        let registry = env.get_account(0);
        let contract = CarbonCreditToken::deploy(&env, CarbonCreditTokenInitArgs {
            name: "Carbon Credit".to_string(),
            symbol: "CRBN".to_string(),
            decimals: 9,
            registry_contract: registry,
        });
        (env, contract, registry)
    }

    #[test]
    fn init_sets_metadata() {
        let (_, mut contract, _) = setup();
        assert_eq!(contract.name(), "Carbon Credit");
        assert_eq!(contract.symbol(), "CRBN");
        assert_eq!(contract.decimals(), 9);
        assert_eq!(contract.total_supply(), U256::zero());
    }

    #[test]
    fn registry_mints_tokens() {
        let (env, mut contract, registry) = setup();
        let recipient = env.get_account(1);

        env.set_caller(registry);
        contract.mint(&recipient, &U256::from(1000));

        assert_eq!(contract.balance_of(&recipient), U256::from(1000));
        assert_eq!(contract.total_supply(), U256::from(1000));
    }

    #[test]
    fn non_registry_cannot_mint() {
        let (env, mut contract, _) = setup();
        let attacker = env.get_account(2);

        env.set_caller(attacker);
        let err = contract
            .try_mint(&attacker, &U256::from(1000))
            .unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn owner_burns_tokens() {
        let (env, mut contract, registry) = setup();
        let owner = env.get_account(1);

        env.set_caller(registry);
        contract.mint(&owner, &U256::from(1000));

        env.set_caller(owner);
        contract.burn(&owner, &U256::from(300));

        assert_eq!(contract.balance_of(&owner), U256::from(700));
        assert_eq!(contract.total_supply(), U256::from(700));
    }

    #[test]
    fn non_owner_cannot_burn() {
        let (env, mut contract, registry) = setup();
        let owner = env.get_account(1);
        let attacker = env.get_account(2);

        env.set_caller(registry);
        contract.mint(&owner, &U256::from(1000));

        env.set_caller(attacker);
        let err = contract
            .try_burn(&owner, &U256::from(100))
            .unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn transfer_moves_tokens() {
        let (env, mut contract, registry) = setup();
        let sender = env.get_account(1);
        let recipient = env.get_account(2);

        env.set_caller(registry);
        contract.mint(&sender, &U256::from(1000));

        env.set_caller(sender);
        contract.transfer(&recipient, &U256::from(400));

        assert_eq!(contract.balance_of(&sender), U256::from(600));
        assert_eq!(contract.balance_of(&recipient), U256::from(400));
    }

    #[test]
    fn approve_and_transfer_from() {
        let (env, mut contract, registry) = setup();
        let owner = env.get_account(1);
        let spender = env.get_account(2);
        let recipient = env.get_account(3);

        env.set_caller(registry);
        contract.mint(&owner, &U256::from(1000));

        env.set_caller(owner);
        contract.approve(&spender, &U256::from(500));

        assert_eq!(contract.allowance(&owner, &spender), U256::from(500));

        env.set_caller(spender);
        contract.transfer_from(&owner, &recipient, &U256::from(300));

        assert_eq!(contract.balance_of(&owner), U256::from(700));
        assert_eq!(contract.balance_of(&recipient), U256::from(300));
        assert_eq!(contract.allowance(&owner, &spender), U256::from(200));
    }
}
