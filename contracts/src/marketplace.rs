use num_traits::AsPrimitive;
use odra::casper_types::U256;
use odra::prelude::*;
use odra::ContractRef;

use crate::token::CarbonCreditTokenContractRef;

#[odra::module]
pub struct CarbonMarketplace {
    listings: Mapping<u32, Listing>,
    next_listing_id: Var<u32>,
    token_contract: Var<Address>,
    fee_percentage: Var<u32>,
    admin: Var<Address>,
}

#[odra::odra_type]
pub struct Listing {
    pub id: u32,
    pub seller: Address,
    pub project_id: u32,
    pub amount: U256,
    pub price_per_token: U256,
    pub active: bool,
}

#[odra::module]
impl CarbonMarketplace {
    pub fn init(&mut self, admin: Address, token_contract: Address) {
        self.admin.set(admin);
        self.token_contract.set(token_contract);
        self.fee_percentage.set(50u32);
        self.next_listing_id.set(0);
    }

    #[odra(payable)]
    pub fn list(&mut self, project_id: u32, amount: U256, price_per_token: U256) -> u32 {
        let caller = self.env().caller();
        let id = self.next_listing_id.get_or_default();

        let listing = Listing {
            id,
            seller: caller,
            project_id,
            amount,
            price_per_token,
            active: true,
        };

        self.listings.set(&id, listing);
        self.next_listing_id.set(id + 1);
        id
    }

    #[odra(payable)]
    pub fn buy(&mut self, listing_id: u32, token_amount: U256) {
        let buyer = self.env().caller();
        let listing = self
            .listings
            .get(&listing_id)
            .unwrap_or_revert_with(self, Error::ListingNotFound);

        if !listing.active {
            self.env().revert(Error::ListingInactive);
        }
        if token_amount > listing.amount {
            self.env().revert(Error::InsufficientAmount);
        }

        let total_cost = listing.price_per_token * token_amount;
        let attached = self.env().attached_value();
        if attached < total_cost.as_() {
            self.env().revert(Error::InsufficientPayment);
        }

        let fee_bps = self.fee_percentage.get_or_default();
        let fee = total_cost * U256::from(fee_bps) / U256::from(10000);
        let seller_proceeds = total_cost - fee;

        let seller = listing.seller;
        self.env().transfer_tokens(&seller, &seller_proceeds.as_());

        let token_addr = self
            .token_contract
            .get()
            .unwrap_or_revert_with(self, Error::TokenNotSet);
        let mut token_ref = CarbonCreditTokenContractRef::new(self.env(), token_addr);
        token_ref.transfer_from(&seller, &buyer, &token_amount);

        let mut updated = listing;
        updated.amount -= token_amount;
        if updated.amount.is_zero() {
            updated.active = false;
        }
        self.listings.set(&listing_id, updated);
    }

    pub fn cancel_listing(&mut self, listing_id: u32) {
        let caller = self.env().caller();
        let listing = self
            .listings
            .get(&listing_id)
            .unwrap_or_revert_with(self, Error::ListingNotFound);

        if caller != listing.seller {
            self.env().revert(Error::Unauthorized);
        }

        let mut updated = listing;
        updated.active = false;
        self.listings.set(&listing_id, updated);
    }

    pub fn get_listing(&self, listing_id: u32) -> Option<Listing> {
        self.listings.get(&listing_id)
    }

    pub fn set_fee(&mut self, fee_basis_points: u32) {
        let caller = self.env().caller();
        let admin = self.admin.get().unwrap_or_revert_with(self, Error::AdminNotSet);
        if caller != admin {
            self.env().revert(Error::Unauthorized);
        }
        self.fee_percentage.set(fee_basis_points);
    }
}

#[odra::odra_error]
pub enum Error {
    ListingNotFound = 1,
    ListingInactive = 2,
    InsufficientAllowance = 3,
    InsufficientAmount = 4,
    InsufficientPayment = 5,
    TransferFailed = 6,
    Unauthorized = 7,
    TokenNotSet = 8,
    AdminNotSet = 9,
}

#[cfg(test)]
mod tests {
    use num_traits::AsPrimitive;
    use odra::casper_types::U256;
    use odra::host::{Deployer, HostEnv, HostRef};
    use odra::prelude::*;

    use crate::token::{CarbonCreditToken, CarbonCreditTokenHostRef, CarbonCreditTokenInitArgs};

    use super::*;

    struct TestEnv {
        env: HostEnv,
        marketplace: CarbonMarketplaceHostRef,
        token: CarbonCreditTokenHostRef,
        admin: Address,
        registry: Address,
    }

    fn setup() -> TestEnv {
        let env = odra_test::env();
        let admin = env.get_account(0);
        let registry = env.get_account(0);

        let mut token = CarbonCreditToken::deploy(&env, CarbonCreditTokenInitArgs {
            name: "Carbon Credit".to_string(),
            symbol: "CRBN".to_string(),
            decimals: 9,
            registry_contract: registry,
        });

        let mut marketplace = CarbonMarketplace::deploy(&env, CarbonMarketplaceInitArgs {
            admin,
            token_contract: token.address(),
        });

        TestEnv {
            env,
            marketplace,
            token,
            admin,
            registry,
        }
    }

    #[test]
    fn init_sets_fee() {
        let mut test = setup();
        let listing = test.marketplace.get_listing(0);
        assert_eq!(listing, None);
    }

    #[test]
    fn seller_lists_tokens() {
        let mut test = setup();
        let seller = test.env.get_account(1);

        test.env.set_caller(seller);
        let id = test.marketplace.list(
            1,
            U256::from(100),
            U256::from(10),
        );
        assert_eq!(id, 0);

        let listing = test.marketplace.get_listing(0).unwrap();
        assert_eq!(listing.seller, seller);
        assert_eq!(listing.project_id, 1);
        assert_eq!(listing.amount, U256::from(100));
        assert_eq!(listing.price_per_token, U256::from(10));
        assert!(listing.active);
    }

    #[test]
    fn cancel_listing() {
        let mut test = setup();
        let seller = test.env.get_account(1);

        test.env.set_caller(seller);
        let id = test.marketplace.list(1, U256::from(100), U256::from(10));
        test.marketplace.cancel_listing(id);

        let listing = test.marketplace.get_listing(id).unwrap();
        assert!(!listing.active);
    }

    #[test]
    fn non_seller_cannot_cancel() {
        let mut test = setup();
        let seller = test.env.get_account(1);
        let attacker = test.env.get_account(2);

        test.env.set_caller(seller);
        let id = test.marketplace.list(1, U256::from(100), U256::from(10));

        test.env.set_caller(attacker);
        let err = test.marketplace.try_cancel_listing(id).unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn cancel_nonexistent_listing_fails() {
        let mut test = setup();
        let err = test.marketplace.try_cancel_listing(99).unwrap_err();
        assert_eq!(err, Error::ListingNotFound.into());
    }

    #[test]
    fn admin_sets_fee() {
        let mut test = setup();
        test.marketplace.set_fee(200);
    }

    #[test]
    fn non_admin_cannot_set_fee() {
        let mut test = setup();
        let attacker = test.env.get_account(1);
        test.env.set_caller(attacker);
        let err = test.marketplace.try_set_fee(200).unwrap_err();
        assert_eq!(err, Error::Unauthorized.into());
    }

    #[test]
    fn buy_listing_requires_allowance() {
        let mut test = setup();
        let seller = test.env.get_account(1);
        let buyer = test.env.get_account(2);

        test.env.set_caller(seller);
        let id = test.marketplace.list(1, U256::from(100), U256::from(10));

        test.env.set_caller(buyer);
        let err = test
            .marketplace
            .with_tokens(U256::from(1000).as_())
            .try_buy(id, U256::from(10))
            .unwrap_err();
        assert_eq!(err, Error::InsufficientAllowance.into());
    }
}
